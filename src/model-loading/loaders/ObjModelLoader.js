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
    manager.setURLModifier((url) => {
      try {
        const raw = String(url || '');
        // Strip query/hash and keep last segment
        const clean = raw.split('#')[0].split('?')[0];
        const parts = clean.replace(/\\/g, '/').split('/');
        const last = (parts[parts.length - 1] || '').trim();
        if (!last) return raw;
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
      if (mtlFile) {
        const mtlText = await mtlFile.text();
        const mtlLoader = new MTLLoader(manager);
        materials = mtlLoader.parse(mtlText, '');
        try { materials.preload(); } catch (_) {}
      }

      const objText = await objFile.text();
      const objLoader = new OBJLoader(manager);
      if (materials) objLoader.setMaterials(materials);
      const obj = objLoader.parse(objText);

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

      return {
        object3D: obj,
        format: this.id,
        name: objFile.name,
        replacedInViewer: false,
        capabilities: { kind: 'generic' },
      };
    } finally {
      // We keep URLs only during parse/material preload. After parse, textures are loaded into GPU,
      // and three keeps the Image/Bitmap; object URLs can be revoked.
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
}

