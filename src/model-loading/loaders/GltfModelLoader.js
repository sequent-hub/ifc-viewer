import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

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
  /**
   * @param {{ basisTranscoderPath?: string, basisTranscoderCdnPath?: string }} [options]
   */
  constructor(options = {}) {
    this.id = 'gltf';
    this.extensions = ['.gltf', '.glb'];
    this._options = {
      // 1) Try local (consumer can host these files), 2) fallback to CDN.
      basisTranscoderPath: options.basisTranscoderPath || '/three/basis/',
      basisTranscoderCdnPath: options.basisTranscoderCdnPath || 'https://unpkg.com/three@0.149.0/examples/jsm/libs/basis/',
    };
    /** @type {KTX2Loader|null} */
    this._ktx2 = null;
    this._loader = new GLTFLoader();
    try { this._loader.setMeshoptDecoder?.(MeshoptDecoder); } catch (_) {}
  }

  /**
   * @param {File} file
   * @param {any} ctx
   */
  async loadFile(file, ctx) {
    const logger = ctx?.logger || console;
    const name = file?.name || '';
    const lower = name.toLowerCase();
    const t0 = this._perfNow();

    logger?.log?.('[GltfModelLoader] loadFile', { name, size: file?.size });

    // GLB: parse ArrayBuffer
    if (lower.endsWith('.glb')) {
      const tBuf0 = this._perfNow();
      const buf = await file.arrayBuffer();
      const tBuf1 = this._perfNow();
      logger?.log?.('[Perf] gltf:file:arrayBuffer', { ms: Math.round((tBuf1 - tBuf0) * 100) / 100, bytes: buf?.byteLength || 0 });
      const preJson = this._tryReadJsonFromGlb(buf, logger);
      await this._autoConfigureDecoders(preJson, ctx, logger);
      const tParse0 = this._perfNow();
      const gltf = await this._parse(buf, '');
      const tParse1 = this._perfNow();
      logger?.log?.('[Perf] gltf:parse', { ms: Math.round((tParse1 - tParse0) * 100) / 100, source: 'glb' });
      this._logExtensions(gltf, logger);
      const tCompat0 = this._perfNow();
      await this._applyPbrSpecGlossCompat(gltf, logger);
      const tCompat1 = this._perfNow();
      logger?.log?.('[Perf] gltf:compat', { ms: Math.round((tCompat1 - tCompat0) * 100) / 100 });
      this._logSummary(gltf, logger, name);
      const t1 = this._perfNow();
      logger?.log?.('[Perf] gltf:loadFile', { ms: Math.round((t1 - t0) * 100) / 100, name });
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
      const tText0 = this._perfNow();
      const text = await file.text();
      const tText1 = this._perfNow();
      logger?.log?.('[Perf] gltf:file:text', { ms: Math.round((tText1 - tText0) * 100) / 100, bytes: text?.length || 0 });
      let preJson = null;
      try { preJson = JSON.parse(text); } catch (_) { preJson = null; }
      await this._autoConfigureDecoders(preJson, ctx, logger);
      const tParse0 = this._perfNow();
      const gltf = await this._parse(text, '');
      const tParse1 = this._perfNow();
      logger?.log?.('[Perf] gltf:parse', { ms: Math.round((tParse1 - tParse0) * 100) / 100, source: 'gltf' });
      this._logExtensions(gltf, logger);
      const tCompat0 = this._perfNow();
      await this._applyPbrSpecGlossCompat(gltf, logger);
      const tCompat1 = this._perfNow();
      logger?.log?.('[Perf] gltf:compat', { ms: Math.round((tCompat1 - tCompat0) * 100) / 100 });
      this._logSummary(gltf, logger, name);
      const t1 = this._perfNow();
      logger?.log?.('[Perf] gltf:loadFile', { ms: Math.round((t1 - t0) * 100) / 100, name });
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
    const t0 = this._perfNow();
    logger?.log?.('[GltfModelLoader] loadUrl', { url });
    // For URL we usually can't cheaply pre-read JSON without double fetching.
    // Configure decoders "optimistically" (KTX2/Meshopt) so needed extensions work.
    await this._autoConfigureDecoders(null, ctx, logger);
    const tLoad0 = this._perfNow();
    const gltf = await this._loader.loadAsync(url);
    const tLoad1 = this._perfNow();
    logger?.log?.('[Perf] gltf:loadAsync', { ms: Math.round((tLoad1 - tLoad0) * 100) / 100, url });
    this._logExtensions(gltf, logger);
    const tCompat0 = this._perfNow();
    await this._applyPbrSpecGlossCompat(gltf, logger);
    const tCompat1 = this._perfNow();
    logger?.log?.('[Perf] gltf:compat', { ms: Math.round((tCompat1 - tCompat0) * 100) / 100 });
    this._logSummary(gltf, logger, String(url || ''));
    const t1 = this._perfNow();
    logger?.log?.('[Perf] gltf:loadUrl', { ms: Math.round((t1 - t0) * 100) / 100, url });
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

  _perfNow() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  _logExtensions(gltf, logger) {
    try {
      const json = gltf?.parser?.json;
      if (!json) return;
      const used = Array.isArray(json.extensionsUsed) ? json.extensionsUsed.slice().sort() : [];
      const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired.slice().sort() : [];
      if (!used.length && !required.length) return;
      logger?.log?.('[GltfModelLoader] glTF extensions', { used, required });
    } catch (_) {}
  }

  _tryReadJsonFromGlb(arrayBuffer, logger) {
    try {
      const u8 = new Uint8Array(arrayBuffer);
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      if (dv.byteLength < 20) return null;
      // magic 'glTF' = 0x46546C67 (little-endian in file)
      const magic = dv.getUint32(0, true);
      if (magic !== 0x46546c67) return null;
      const version = dv.getUint32(4, true);
      if (version < 2) return null;
      const totalLength = dv.getUint32(8, true);
      if (!Number.isFinite(totalLength) || totalLength <= 0) return null;

      let offset = 12;
      while (offset + 8 <= dv.byteLength) {
        const chunkLength = dv.getUint32(offset, true);
        const chunkType = dv.getUint32(offset + 4, true);
        offset += 8;
        if (offset + chunkLength > dv.byteLength) break;
        // JSON chunk type 'JSON' = 0x4E4F534A
        if (chunkType === 0x4E4F534A) {
          const bytes = u8.subarray(offset, offset + chunkLength);
          const text = new TextDecoder().decode(bytes);
          return JSON.parse(text);
        }
        offset += chunkLength;
      }
      return null;
    } catch (e) {
      logger?.warn?.('[GltfModelLoader] failed to pre-read GLB JSON chunk', e);
      return null;
    }
  }

  async _autoConfigureDecoders(preJson, ctx, logger) {
    // Meshopt is already set in constructor (best-effort).
    // KTX2/BasisU: enable if we can, because users may load glb with KHR_texture_basisu.
    const used = Array.isArray(preJson?.extensionsUsed) ? preJson.extensionsUsed : null;
    const required = Array.isArray(preJson?.extensionsRequired) ? preJson.extensionsRequired : null;
    const needsBasisu =
      (used ? used.includes('KHR_texture_basisu') : true) ||
      (required ? required.includes('KHR_texture_basisu') : false);
    if (!needsBasisu) return;

    const renderer = ctx?.viewer?.renderer || ctx?.renderer || null;
    if (!renderer) {
      // We can still set loader, but detectSupport needs renderer. Keep it lazy.
      logger?.warn?.('[GltfModelLoader] KTX2Loader not fully initialized (no renderer in ctx). BasisU textures may be unavailable.');
      return;
    }

    if (!this._ktx2) this._ktx2 = new KTX2Loader();

    // Try local path first; if missing — fallback to CDN.
    const localPath = this._options.basisTranscoderPath;
    const cdnPath = this._options.basisTranscoderCdnPath;

    const hasLocal = await this._checkTranscoderAvailable(localPath);
    const basePath = hasLocal ? localPath : cdnPath;
    if (!hasLocal) {
      logger?.warn?.('[GltfModelLoader] Basis transcoder not found at local path, using CDN fallback', { localPath, cdnPath });
    }

    try {
      this._ktx2.setTranscoderPath(basePath);
      await this._ktx2.detectSupport(renderer);
      this._loader.setKTX2Loader?.(this._ktx2);
      logger?.log?.('[GltfModelLoader] KTX2Loader enabled', { transcoderPath: basePath });
    } catch (e) {
      logger?.warn?.('[GltfModelLoader] KTX2Loader init failed; BasisU textures may be unavailable', e);
    }
  }

  async _checkTranscoderAvailable(basePath) {
    try {
      if (typeof fetch !== 'function') return false;
      const p = String(basePath || '');
      if (!p) return false;
      const url = (p.endsWith('/') ? p : (p + '/')) + 'basis_transcoder.wasm';
      const res = await fetch(url, { method: 'HEAD' });
      return !!res && res.ok;
    } catch (_) {
      return false;
    }
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

