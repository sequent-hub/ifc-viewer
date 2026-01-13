import { Box3, LoadingManager, Vector3 } from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";

/**
 * COLLADA (.dae) loader with optional textures via multi-file selection.
 *
 * Multi-file behavior:
 * - User may select:
 *   - only .dae -> load scene, external images may be missing
 *   - .dae + images -> resolve images by basename via LoadingManager URL modifier
 *
 * Notes:
 * - ColladaLoader typically handles up-axis conversion based on <asset><up_axis>.
 */
export class DaeModelLoader {
  /**
   * @param {{ rotateXNeg90?: boolean, alignToGround?: boolean }} [options]
   * rotateXNeg90:
   * - Some DAE assets are effectively Z-up; viewer is Y-up. This rotates into Y-up.
   * alignToGround:
   * - Moves model so its bbox.min.y becomes ~0 (helps shadow receiver positioning).
   */
  constructor(options = {}) {
    this.id = 'dae';
    this.extensions = ['.dae'];
    this.associatedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tga'];
    this._loader = null;
    this._rotateXNeg90 = options.rotateXNeg90 !== false; // default true
    this._alignToGround = options.alignToGround !== false; // default true
  }

  async loadFile(file, ctx) {
    return await this.loadFiles([file], ctx);
  }

  /**
   * @param {File[]|FileList} files
   * @param {any} ctx
   */
  async loadFiles(files, ctx) {
    const logger = ctx?.logger || console;
    const arr = Array.from(files || []).filter(Boolean);
    if (!arr.length) throw new Error('DaeModelLoader: no files');

    const daeFile = arr.find((f) => this._isExt(f?.name, '.dae'));
    if (!daeFile) {
      throw new Error(`DaeModelLoader: .dae not found in selection: ${arr.map((f) => f?.name).filter(Boolean).join(', ')}`);
    }

    const fileMap = this._buildFileMap(arr);
    const urlMap = new Map();
    const revokeAll = () => {
      try { for (const u of urlMap.values()) URL.revokeObjectURL(u); } catch (_) {}
    };
    const getBlobUrl = (key) => {
      const k = String(key || '').toLowerCase();
      if (!k) return null;
      if (urlMap.has(k)) return urlMap.get(k);
      const f = fileMap.get(k);
      if (!f) return null;
      const u = URL.createObjectURL(f);
      urlMap.set(k, u);
      return u;
    };

    const manager = new LoadingManager();
    /** @type {Set<string>} */
    const failedUrls = new Set();
    /** @type {Set<string>} */
    const requestedBasenames = new Set();

    manager.onError = (url) => {
      try {
        const raw = String(url || '');
        const clean = raw.split('#')[0].split('?')[0];
        const parts = clean.replace(/\\/g, '/').split('/');
        const last = (parts[parts.length - 1] || '').trim();
        if (last) failedUrls.add(last);
      } catch (_) {}
    };

    manager.setURLModifier((url) => {
      try {
        const raw = String(url || '');
        const clean = raw.split('#')[0].split('?')[0];
        const parts = clean.replace(/\\/g, '/').split('/');
        const last = (parts[parts.length - 1] || '').trim();
        if (!last) return raw;
        requestedBasenames.add(last);
        const blob = getBlobUrl(last);
        return blob || raw;
      } catch (_) {
        return url;
      }
    });

    try {
      logger?.log?.('[DaeModelLoader] loadFiles', { dae: daeFile.name, files: arr.map((f) => f?.name).filter(Boolean) });
      const daeText = await daeFile.text();

      // Diagnostics: inspect raw DAE for image references and textures
      try {
        const diag = this._diagnoseDaeText(daeText);
        // eslint-disable-next-line no-console
        logger?.log?.('[DaeModelLoader] dae diagnostics', diag);
      } catch (e) {
        logger?.warn?.('[DaeModelLoader] dae diagnostics failed', e);
      }

      const loader = new ColladaLoader(manager);
      const collada = loader.parse(daeText, '');

      // Wait for async texture loads (if any) before revoking blob URLs.
      await this._waitManagerIdle(manager, 2500);

      const scene = collada?.scene;
      if (!scene) throw new Error('DaeModelLoader: parsed without scene');
      try { scene.updateMatrixWorld?.(true); } catch (_) {}

      // Axis + grounding BEFORE Viewer.replaceWithModel(): ensures bbox/shadowReceiver computed correctly.
      try {
        if (this._rotateXNeg90) {
          scene.rotation.x = -Math.PI / 2;
          scene.updateMatrixWorld?.(true);
        }
        if (this._alignToGround) {
          const box = new Box3().setFromObject(scene);
          const minY = box.min.y;
          if (Number.isFinite(minY)) {
            // Bring model to "floor" level
            scene.position.y -= minY;
            // Tiny epsilon to avoid z-fighting with receiver
            scene.position.y += 0.001;
            scene.updateMatrixWorld?.(true);
          }
        }
      } catch (_) {}

      const missingAll = Array.from(new Set([...Array.from(failedUrls.values())]));
      if (missingAll.length) {
        logger?.warn?.('[DaeModelLoader] missing assets (select these files too):', missingAll);
      } else if (requestedBasenames.size) {
        // If images referenced but none failed, still helpful to log what was requested
        logger?.log?.('[DaeModelLoader] referenced assets', { requested: Array.from(requestedBasenames.values()).slice(0, 30) });
      }

      // Diagnostics: meshes/materials
      try {
        let meshes = 0;
        let mats = 0;
        let withMap = 0;
        scene.traverse?.((n) => {
          if (!n?.isMesh) return;
          meshes++;
          const m = n.material;
          const arrM = Array.isArray(m) ? m : [m];
          for (const mi of arrM) {
            if (!mi) continue;
            mats++;
            if (mi.map) withMap++;
          }
        });
        // BBox after axis/grounding for diagnostics
        let bbox = null;
        try {
          const b = new Box3().setFromObject(scene);
          const size = b.getSize(new Vector3());
          const center = b.getCenter(new Vector3());
          bbox = {
            size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
            center: { x: +center.x.toFixed(3), y: +center.y.toFixed(3), z: +center.z.toFixed(3) },
            minY: +b.min.y.toFixed(3),
          };
        } catch (_) {}
        logger?.log?.('[DaeModelLoader] parsed', {
          dae: daeFile.name,
          meshes,
          materials: mats,
          withMap,
          animations: collada?.animations?.length || 0,
          bbox,
          axisFix: { rotateXNeg90: this._rotateXNeg90, alignToGround: this._alignToGround },
        });
      } catch (_) {}

      return {
        object3D: scene,
        format: this.id,
        name: daeFile.name,
        replacedInViewer: false,
        capabilities: { kind: 'generic', missingAssets: missingAll, animations: collada?.animations || [] },
      };
    } finally {
      revokeAll();
    }
  }

  _isExt(name, ext) {
    const n = String(name || '').toLowerCase();
    return n.endsWith(String(ext).toLowerCase());
  }

  _buildFileMap(arr) {
    const map = new Map();
    for (const f of arr) {
      const full = String(f?.name || '');
      if (!full) continue;
      const base = (full.split(/[/\\]/).pop() || full).toLowerCase();
      if (!map.has(base)) map.set(base, f);
    }
    return map;
  }

  _waitManagerIdle(manager, timeoutMs = 2000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        const prevOnLoad = manager.onLoad;
        manager.onLoad = () => {
          try { prevOnLoad?.(); } catch (_) {}
          finish();
        };
      } catch (_) {}
      setTimeout(finish, Math.max(0, Number(timeoutMs) || 0));
    });
  }

  _diagnoseDaeText(daeText) {
    const text = String(daeText || '');
    // Up-axis (if present)
    const upAxisMatch = text.match(/<up_axis>\s*([^<]+)\s*<\/up_axis>/i);
    const upAxis = upAxisMatch ? upAxisMatch[1].trim() : null;

    // <init_from> values inside library_images
    const initFrom = [];
    const reInit = /<init_from>\s*([^<]+?)\s*<\/init_from>/gi;
    let m;
    while ((m = reInit.exec(text)) !== null) {
      const raw = (m[1] || '').trim();
      if (raw) initFrom.push(raw);
      if (initFrom.length >= 200) break; // cap
    }

    // Extract basenames and file extensions (for comparing to selected files)
    const basenames = initFrom.map((p) => (p.replace(/\\/g, '/').split('/').pop() || p).trim()).filter(Boolean);
    const jpgs = basenames.filter((b) => /\.(jpe?g)$/i.test(b));
    const pngs = basenames.filter((b) => /\.png$/i.test(b));

    // Look for <texture ...> occurrences (typical COLLADA material binding)
    const texTags = [];
    const reTex = /<texture\b[^>]*>/gi;
    while ((m = reTex.exec(text)) !== null) {
      texTags.push(m[0]);
      if (texTags.length >= 50) break;
    }

    return {
      upAxis,
      initFromCount: initFrom.length,
      initFromSample: initFrom.slice(0, 12),
      imageBasenameCount: basenames.length,
      imageBasenameSample: basenames.slice(0, 12),
      jpgCount: jpgs.length,
      pngCount: pngs.length,
      textureTagCount: texTags.length,
      textureTagSample: texTags.slice(0, 6),
    };
  }
}

