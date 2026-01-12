import { LoadingManager } from "three";
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";

/**
 * 3DS loader (TDSLoader) with optional textures via multi-file selection.
 *
 * Multi-file behavior:
 * - User may select:
 *   - only .3ds -> load geometry/materials from file, textures may be missing
 *   - .3ds + textures -> resolve textures by basename via LoadingManager URL modifier
 */
export class TdsModelLoader {
  /**
   * @param {{ rotateXNeg90?: boolean }} [options]
   * rotateXNeg90:
   * - Many 3DS assets are effectively Z-up; this rotates them into Y-up (viewer default).
   */
  constructor(options = {}) {
    this.id = '3ds';
    this.extensions = ['.3ds'];
    // For file picker convenience (accept=): allow selecting common texture formats.
    this.associatedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tga'];
    this._rotateXNeg90 = options.rotateXNeg90 !== false; // default true
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
    if (!arr.length) throw new Error('TdsModelLoader: no files');

    const mainFile = arr.find((f) => this._isExt(f?.name, '.3ds'));
    if (!mainFile) {
      throw new Error(`TdsModelLoader: .3ds not found in selection: ${arr.map((f) => f?.name).filter(Boolean).join(', ')}`);
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
      logger?.log?.('[TdsModelLoader] loadFiles', {
        file: mainFile.name,
        files: arr.map((f) => f?.name).filter(Boolean),
      });

      const buf = await mainFile.arrayBuffer();
      const loader = new TDSLoader(manager);

      // parse() accepts ArrayBuffer
      const obj = loader.parse(buf, '');

      // Axis fix BEFORE Viewer.replaceWithModel(): ensures bbox/shadowReceiver computed correctly.
      if (this._rotateXNeg90) {
        try {
          obj.rotation.x = -Math.PI / 2;
          obj.updateMatrixWorld?.(true);
        } catch (_) {}
      }

      // Wait for async texture loads (if any) before revoking blob URLs.
      await this._waitManagerIdle(manager, 2500);

      // Diagnostics: mesh/material/texture stats
      try {
        let meshes = 0;
        let mats = 0;
        let withMap = 0;
        obj.traverse?.((n) => {
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
        logger?.log?.('[TdsModelLoader] parsed', { file: mainFile.name, meshes, materials: mats, withMap });
      } catch (_) {}

      const missingAll = Array.from(new Set([...Array.from(failedUrls.values())]));
      if (missingAll.length) {
        logger?.warn?.('[TdsModelLoader] missing assets (select these files too):', missingAll);
      } else {
        // If no textures attached, warn with requested basenames (if any)
        try {
          let withMap = 0;
          obj.traverse?.((n) => {
            if (!n?.isMesh) return;
            const m = n.material;
            const arrM = Array.isArray(m) ? m : [m];
            for (const mi of arrM) if (mi?.map) withMap++;
          });
          if (withMap === 0 && requestedBasenames.size) {
            logger?.warn?.('[TdsModelLoader] Textures were referenced but not attached. Ensure you selected all referenced image files.', {
              requested: Array.from(requestedBasenames.values()).slice(0, 30),
            });
          }
        } catch (_) {}
      }

      return {
        object3D: obj,
        format: this.id,
        name: mainFile.name,
        replacedInViewer: false,
        capabilities: {
          kind: 'generic',
          missingAssets: missingAll,
        },
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
    // Map by basename only (common in texture references)
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
}

