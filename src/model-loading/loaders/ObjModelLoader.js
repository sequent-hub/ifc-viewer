import { LoadingManager } from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

/**
 * OBJ loader with optional MTL support.
 *
 * Multi-file behavior (for <input multiple>):
 * - User may select:
 *   - only .obj  -> load OBJ without MTL
 *   - .obj + .mtl (+ textures) -> apply MTL and resolve textures from selected files
 *
 * Important: browser cannot access "neighbor" files unless the user selected them.
 */
export class ObjModelLoader {
  constructor() {
    this.id = 'obj';
    this.extensions = ['.obj'];
    // For file picker convenience (accept=): allow selecting MTL + common textures.
    this.associatedExtensions = ['.mtl', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tga'];
  }

  async loadFile(file, ctx) {
    // Fallback: single OBJ only
    return await this.loadFiles([file], ctx);
  }

  /**
   * @param {File[]|FileList} files
   * @param {any} ctx
   */
  async loadFiles(files, ctx) {
    const logger = ctx?.logger || console;
    const arr = Array.from(files || []).filter(Boolean);
    if (!arr.length) throw new Error('ObjModelLoader: no files');

    const objFile = this._pickObj(arr);
    if (!objFile) {
      throw new Error(`ObjModelLoader: .obj not found in selection: ${arr.map((f) => f?.name).filter(Boolean).join(', ')}`);
    }

    const base = this._basenameNoExt(objFile.name);
    const mtlFile =
      arr.find((f) => this._isExt(f?.name, '.mtl') && this._basenameNoExt(f.name).toLowerCase() === base.toLowerCase())
      || arr.find((f) => this._isExt(f?.name, '.mtl'));

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

    // URL modifier: map any relative texture file name to the selected files
    const manager = new LoadingManager();
    /** @type {Set<string>} */
    const failedUrls = new Set();
    /** @type {Set<string>} */
    const requestedBasenames = new Set();
    // Track loader-level failures (useful when MTL parsing doesn't reveal all refs)
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
        // Strip query/hash and keep last segment
        const clean = raw.split('#')[0].split('?')[0];
        const parts = clean.replace(/\\/g, '/').split('/');
        const last = (parts[parts.length - 1] || '').trim();
        if (!last) return raw;
        requestedBasenames.add(last);
        const key = last.toLowerCase();
        const blob = getBlobUrl(key);
        return blob || raw;
      } catch (_) {
        return url;
      }
    });

    try {
      logger?.log?.('[ObjModelLoader] loadFiles', {
        obj: objFile.name,
        mtl: mtlFile ? mtlFile.name : null,
        files: arr.map((f) => f?.name).filter(Boolean),
      });

      // If MTL exists, parse and apply materials
      let materials = null;
      let missingTextures = [];
      if (mtlFile) {
        const mtlText = await mtlFile.text();
        // Diagnostics: detect missing referenced textures in MTL
        try {
          const refs = this._extractTextureRefsFromMtl(mtlText);
          missingTextures = this._findMissingRefs(refs, fileMap);
          if (missingTextures.length) {
            logger?.warn?.('[ObjModelLoader] MTL references missing texture files (select them too):', missingTextures);
          }
        } catch (_) {}
        const mtlLoader = new MTLLoader(manager);
        materials = mtlLoader.parse(mtlText, '');
        // IMPORTANT: preload loads textures asynchronously via manager.
        // We must NOT revoke blob: URLs until these loads finish.
        try { materials.preload(); } catch (_) {}
      }

      const objText = await objFile.text();
      const objLoader = new OBJLoader(manager);
      if (materials) objLoader.setMaterials(materials);
      const obj = objLoader.parse(objText);

      // Wait a bit for async texture loads to complete before revoking blob URLs.
      // If there are no textures, onLoad can fire immediately; otherwise it will fire when all are done.
      await this._waitManagerIdle(manager, 2500);

      // Diagnostics: mesh/material counts
      try {
        let meshes = 0;
        let mats = 0;
        obj.traverse?.((n) => {
          if (!n?.isMesh) return;
          meshes++;
          const m = n.material;
          mats += Array.isArray(m) ? m.length : (m ? 1 : 0);
        });
        logger?.log?.('[ObjModelLoader] parsed', { obj: objFile.name, meshes, materials: mats, hasMtl: !!mtlFile });
      } catch (_) {}

      // Merge "missing by parse" + "failed at load time"
      const missingAll = Array.from(new Set([...(missingTextures || []), ...Array.from(failedUrls.values())]));
      if (missingAll.length) {
        logger?.warn?.('[ObjModelLoader] missing assets (select these files too):', missingAll);
      } else if (mtlFile) {
        // If MTL exists but no maps got attached, warn proactively
        try {
          let withMap = 0;
          obj.traverse?.((n) => {
            if (!n?.isMesh) return;
            const m = n.material;
            const arrM = Array.isArray(m) ? m : [m];
            for (const mi of arrM) if (mi?.map) withMap++;
          });
          if (withMap === 0) {
            logger?.warn?.('[ObjModelLoader] MTL loaded, but no texture maps attached. Ensure you selected all referenced image files.', {
              requested: Array.from(requestedBasenames.values()).slice(0, 30),
            });
          }
        } catch (_) {}
      }

      return {
        object3D: obj,
        format: this.id,
        name: objFile.name,
        replacedInViewer: false,
        capabilities: {
          kind: 'generic',
          hasMtl: !!mtlFile,
          missingAssets: missingAll,
        },
      };
    } finally {
      // We keep URLs until manager finishes async texture loads (or timeout above).
      revokeAll();
    }
  }

  _pickObj(arr) {
    // Prefer .obj; if multiple, take first
    return arr.find((f) => this._isExt(f?.name, '.obj')) || null;
  }

  _isExt(name, ext) {
    const n = String(name || '').toLowerCase();
    return n.endsWith(String(ext).toLowerCase());
  }

  _basenameNoExt(name) {
    const n = String(name || '');
    const base = n.split(/[/\\]/).pop() || n;
    const i = base.lastIndexOf('.');
    return (i >= 0) ? base.slice(0, i) : base;
  }

  _buildFileMap(arr) {
    // Map by basename only (common in MTL references)
    const map = new Map();
    for (const f of arr) {
      const full = String(f?.name || '');
      if (!full) continue;
      const base = (full.split(/[/\\]/).pop() || full).toLowerCase();
      if (!map.has(base)) map.set(base, f);
    }
    return map;
  }

  _extractTextureRefsFromMtl(mtlText) {
    // Parse only texture map statements. We keep basenames; actual resolve happens via URLModifier.
    const text = String(mtlText || '');
    const lines = text.split(/\r?\n/);
    const out = new Set();

    for (let line of lines) {
      line = String(line || '').trim();
      if (!line || line.startsWith('#')) continue;
      // strip inline comment
      const hash = line.indexOf('#');
      if (hash >= 0) line = line.slice(0, hash).trim();
      if (!line) continue;

      // Tokenize while keeping simple quoted paths
      // Most MTL files are simple: last token is path, options before it.
      const tokens = line.match(/"[^"]+"|\S+/g) || [];
      if (tokens.length < 2) continue;
      const keyword = String(tokens[0] || '').toLowerCase();
      // Typical texture statements (robust to tabs/multiple spaces)
      const isTexKeyword = (
        keyword === 'map_kd' ||
        keyword === 'map_ka' ||
        keyword === 'map_ks' ||
        keyword === 'map_ke' ||
        keyword === 'map_ns' ||
        keyword === 'map_d' ||
        keyword === 'map_bump' ||
        keyword === 'bump' ||
        keyword === 'disp' ||
        keyword === 'decal' ||
        keyword === 'refl'
      );
      if (!isTexKeyword) continue;

      // Remove the statement keyword
      tokens.shift();

      // Remove known options and their args (best-effort)
      const rest = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (!t) continue;
        if (t.startsWith('-')) {
          // options with 1-3 numeric args are common
          const opt = t.toLowerCase();
          const skipArgs = (opt === '-o' || opt === '-s' || opt === '-t') ? 3
            : (opt === '-mm') ? 2
            : (opt === '-bm') ? 1
            : (opt === '-imfchan') ? 1
            : (opt === '-type') ? 1
            : 0;
          i += skipArgs;
          continue;
        }
        rest.push(t);
      }
      if (!rest.length) continue;

      const rawPath = rest[rest.length - 1].replace(/^"|"$/g, '');
      const base = (rawPath.split(/[/\\]/).pop() || rawPath).trim();
      if (!base) continue;
      out.add(base);
    }

    return Array.from(out.values());
  }

  _findMissingRefs(refBasenames, fileMap) {
    const missing = [];
    for (const b of (refBasenames || [])) {
      const key = String(b || '').toLowerCase();
      if (!key) continue;
      if (!fileMap.has(key)) missing.push(b);
    }
    return missing;
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

