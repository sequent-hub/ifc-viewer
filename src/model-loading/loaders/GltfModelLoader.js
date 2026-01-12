import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * glTF / GLB loader.
 *
 * Notes (important for diagnostics):
 * - .glb is usually self-contained (good for <input type="file">).
 * - .gltf often references external .bin / textures. That works well for URL loading
 *   (served by dev server), but when selecting a single .gltf file from disk, those
 *   external resources will likely be missing. We log a warning in that case.
 */
export class GltfModelLoader {
  constructor() {
    this.id = 'gltf';
    this.extensions = ['.gltf', '.glb'];
    this._loader = new GLTFLoader();
  }

  /**
   * @param {File} file
   * @param {any} ctx
   */
  async loadFile(file, ctx) {
    const logger = ctx?.logger || console;
    const name = file?.name || '';
    const lower = name.toLowerCase();

    logger?.log?.('[GltfModelLoader] loadFile', { name, size: file?.size });

    // GLB: parse ArrayBuffer
    if (lower.endsWith('.glb')) {
      const buf = await file.arrayBuffer();
      const gltf = await this._parse(buf, '');
      await this._applyPbrSpecGlossCompat(gltf, logger);
      this._logSummary(gltf, logger, name);
      return {
        object3D: gltf.scene,
        format: this.id,
        name,
        replacedInViewer: false,
        capabilities: { kind: 'generic' },
      };
    }

    // GLTF: parse JSON string (external resources likely missing for File input)
    if (lower.endsWith('.gltf')) {
      logger?.warn?.('[GltfModelLoader] .gltf selected from disk: external .bin/textures may be missing (consider loading via URL from /public/).');
      const text = await file.text();
      const gltf = await this._parse(text, '');
      await this._applyPbrSpecGlossCompat(gltf, logger);
      this._logSummary(gltf, logger, name);
      return {
        object3D: gltf.scene,
        format: this.id,
        name,
        replacedInViewer: false,
        capabilities: { kind: 'generic' },
      };
    }

    throw new Error(`GltfModelLoader: unsupported file: ${name}`);
  }

  /**
   * @param {string} url
   * @param {any} ctx
   */
  async loadUrl(url, ctx) {
    const logger = ctx?.logger || console;
    logger?.log?.('[GltfModelLoader] loadUrl', { url });
    const gltf = await this._loader.loadAsync(url);
    await this._applyPbrSpecGlossCompat(gltf, logger);
    this._logSummary(gltf, logger, String(url || ''));
    return {
      object3D: gltf.scene,
      format: this.id,
      name: String(url || ''),
      replacedInViewer: false,
      capabilities: { kind: 'generic' },
    };
  }

  _parse(data, path) {
    return new Promise((resolve, reject) => {
      this._loader.parse(
        data,
        path || '',
        (gltf) => resolve(gltf),
        (err) => reject(err),
      );
    });
  }

  _logSummary(gltf, logger, name) {
    try {
      const scene = gltf?.scene;
      let meshes = 0;
      scene?.traverse?.((n) => { if (n?.isMesh) meshes++; });
      logger?.log?.('[GltfModelLoader] parsed', {
        name,
        scene: scene ? { type: scene.type, children: Array.isArray(scene.children) ? scene.children.length : undefined } : null,
        meshes,
        animations: Array.isArray(gltf?.animations) ? gltf.animations.length : 0,
      });
    } catch (_) {}
  }

  /**
   * Compatibility: KHR_materials_pbrSpecularGlossiness
   *
   * Some glb files (including some system-provided samples) use the legacy
   * spec/gloss workflow extension. Newer GLTFLoader versions may not convert it.
   * We map the most visible parts (diffuseFactor/diffuseTexture) onto the already
   * created MeshStandardMaterial, so the model is not "white".
   *
   * @private
   */
  async _applyPbrSpecGlossCompat(gltf, logger) {
    const parser = gltf?.parser;
    const json = parser?.json;
    const materialDefs = json?.materials;
    if (!parser || !Array.isArray(materialDefs) || materialDefs.length === 0) return;

    // Fast check: extension used?
    let any = false;
    for (const md of materialDefs) {
      if (md?.extensions?.KHR_materials_pbrSpecularGlossiness) { any = true; break; }
    }
    if (!any) return;

    let patched = 0;
    let patchedWithTexture = 0;
    let texCoordNonZero = 0;

    try {
      const materials = await parser.getDependencies('material');
      for (let i = 0; i < materialDefs.length; i++) {
        const ext = materialDefs[i]?.extensions?.KHR_materials_pbrSpecularGlossiness;
        if (!ext) continue;
        const mat = materials?.[i];
        if (!mat) continue;

        // diffuseFactor: [r,g,b,a]
        const df = Array.isArray(ext.diffuseFactor) ? ext.diffuseFactor : null;
        if (df && df.length >= 3 && mat?.color?.setRGB) {
          const r = Number(df[0]); const g = Number(df[1]); const b = Number(df[2]);
          if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            mat.color.setRGB(r, g, b);
          }
          if (df.length >= 4) {
            const a = Number(df[3]);
            if (Number.isFinite(a)) {
              mat.opacity = Math.min(1, Math.max(0, a));
              mat.transparent = mat.opacity < 0.999;
            }
          }
        }

        // diffuseTexture: { index, texCoord? }
        const dt = ext.diffuseTexture;
        const texIndex = dt?.index;
        if (Number.isInteger(texIndex)) {
          try {
            const tex = await parser.getDependency('texture', texIndex);
            if (tex) {
              mat.map = tex;
              patchedWithTexture++;
              const tc = dt?.texCoord;
              if (tc != null && Number(tc) !== 0) texCoordNonZero++;
            }
          } catch (_) {}
        }

        // Approximate conversion hints (optional): make it less "plastic"
        try {
          if ('metalness' in mat) mat.metalness = 0.0;
          if ('roughness' in mat && typeof ext.glossinessFactor === 'number') {
            mat.roughness = Math.min(1, Math.max(0, 1 - ext.glossinessFactor));
          }
        } catch (_) {}

        try { mat.needsUpdate = true; } catch (_) {}
        patched++;
      }
    } catch (_) {
      return;
    }

    if (texCoordNonZero > 0) {
      logger?.warn?.('[GltfModelLoader] KHR_materials_pbrSpecularGlossiness uses non-zero texCoord; multi-UV mapping may require extra handling in this three.js revision.', { texCoordNonZero });
    }
    logger?.log?.('[GltfModelLoader] KHR_materials_pbrSpecularGlossiness compat applied', { patched, patchedWithTexture });
  }
}

