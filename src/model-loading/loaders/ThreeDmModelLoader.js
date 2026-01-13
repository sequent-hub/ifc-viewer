import { Box3, Vector3 } from 'three';
import { Rhino3dmLoader } from 'three/examples/jsm/loaders/3DMLoader.js';

/**
 * Rhino 3DM loader.
 *
 * Notes:
 * - Requires `rhino3dm.js` and `rhino3dm.wasm` to be served from a library path.
 *   In this package we copy them to `/public/wasm/rhino3dm/` via postinstall script.
 */
export class ThreeDmModelLoader {
  /**
   * @param {{ libraryPath?: string, workerLimit?: number, rotateXNeg90?: boolean, alignToGround?: boolean }} [options]
   */
  constructor(options = {}) {
    this.id = '3dm';
    this.extensions = ['.3dm'];
    this._libraryPath = options.libraryPath || '/wasm/rhino3dm/';
    this._workerLimit = Number.isFinite(options.workerLimit) ? Number(options.workerLimit) : 4;
    // Many 3DM assets are effectively Z-up; viewer is Y-up. Keep consistent with other format loaders.
    this._rotateXNeg90 = options.rotateXNeg90 !== false; // default true
    // Bring model down to ground plane so shadow receiver is correct.
    this._alignToGround = options.alignToGround !== false; // default true
  }

  /**
   * @param {File} file
   * @param {any} ctx
   */
  async loadFile(file, ctx) {
    const url = URL.createObjectURL(file);
    try {
      const obj = await this._loadInternal(url, ctx);
      return {
        object3D: obj,
        format: this.id,
        name: file?.name || '',
        replacedInViewer: false,
        capabilities: { kind: 'generic' },
      };
    } finally {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  }

  /**
   * @param {string} url
   * @param {any} ctx
   */
  async loadUrl(url, ctx) {
    const obj = await this._loadInternal(url, ctx);
    return {
      object3D: obj,
      format: this.id,
      name: String(url || ''),
      replacedInViewer: false,
      capabilities: { kind: 'generic' },
    };
  }

  async _loadInternal(url, ctx) {
    const logger = ctx?.logger || console;
    const libraryPath = (ctx?.rhino3dmLibraryPath || this._libraryPath || '').toString();
    const normalizedPath = libraryPath.endsWith('/') ? libraryPath : `${libraryPath}/`;

    const loader = new Rhino3dmLoader();
    loader.setLibraryPath(normalizedPath);
    loader.setWorkerLimit(this._workerLimit);

    logger?.log?.('[ThreeDmModelLoader] load', {
      url: String(url || ''),
      libraryPath: normalizedPath,
      workerLimit: this._workerLimit,
    });

    let obj = null;
    try {
      obj = await new Promise((resolve, reject) => {
        try {
          loader.load(
            url,
            (result) => resolve(result),
            undefined,
            (err) => reject(err)
          );
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      const msg = String(e?.message || e?.error?.message || e || '');
      if (msg.includes('.count is not a function')) {
        logger?.error?.(
          '[ThreeDmModelLoader] rhino3dm API mismatch detected. This often happens when rhino3dm version is not compatible with three/examples 3DMLoader. ' +
            'For three@0.149.0 a compatible rhino3dm version is ~8.4.0.'
        );
      }
      throw e;
    }

    // Axis + grounding BEFORE Viewer.replaceWithModel(): ensures bbox/shadowReceiver computed correctly.
    try {
      if (obj) {
        if (this._rotateXNeg90) {
          obj.rotation.x = -Math.PI / 2;
          obj.updateMatrixWorld?.(true);
        }
        if (this._alignToGround) {
          const box = new Box3().setFromObject(obj);
          const minY = box.min.y;
          if (Number.isFinite(minY)) {
            obj.position.y -= minY;
            obj.position.y += 0.001; // epsilon to avoid z-fighting with shadow receiver
            obj.updateMatrixWorld?.(true);
          }
        }
      }
    } catch (_) {}

    // Basic diagnostics
    try {
      let meshes = 0;
      let mats = 0;
      obj?.traverse?.((n) => {
        if (!n?.isMesh) return;
        meshes++;
        const m = n.material;
        const arr = Array.isArray(m) ? m : [m];
        for (const mi of arr) if (mi) mats++;
      });
      let bbox = null;
      try {
        const b = new Box3().setFromObject(obj);
        const size = b.getSize(new Vector3());
        const center = b.getCenter(new Vector3());
        bbox = {
          size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
          center: { x: +center.x.toFixed(3), y: +center.y.toFixed(3), z: +center.z.toFixed(3) },
        };
      } catch (_) {}
      logger?.log?.('[ThreeDmModelLoader] parsed', { meshes, materials: mats, bbox });
    } catch (_) {}

    return obj;
  }
}

