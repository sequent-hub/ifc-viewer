import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

/**
 * FBX loader.
 *
 * Implementation detail:
 * - For File: uses FBXLoader.parse(ArrayBuffer, path).
 * - For URL: uses FBXLoader.loadAsync(url).
 *
 * Known limitations to be aware of (diagnose via logs):
 * - External texture references near a local File are not resolved automatically.
 */
export class FbxModelLoader {
  constructor() {
    this.id = 'fbx';
    this.extensions = ['.fbx'];
    this._loader = new FBXLoader();
  }

  /**
   * @param {File} file
   * @param {any} ctx
   */
  async loadFile(file, ctx) {
    const logger = ctx?.logger || console;
    const name = file?.name || '';
    logger?.log?.('[FbxModelLoader] loadFile', { name, size: file?.size });

    const buf = await file.arrayBuffer();
    const obj = this._loader.parse(buf, '');
    // Useful diagnostics: count meshes quickly
    try {
      let meshes = 0;
      obj.traverse?.((n) => { if (n?.isMesh) meshes++; });
      logger?.log?.('[FbxModelLoader] parsed', { name, type: obj?.type, meshes });
    } catch (_) {}

    return {
      object3D: obj,
      format: this.id,
      name,
      replacedInViewer: false,
      capabilities: {
        kind: 'generic',
      },
    };
  }

  /**
   * @param {string} url
   * @param {any} ctx
   */
  async loadUrl(url, ctx) {
    const logger = ctx?.logger || console;
    logger?.log?.('[FbxModelLoader] loadUrl', { url });
    const obj = await this._loader.loadAsync(url);
    return {
      object3D: obj,
      format: this.id,
      name: String(url || ''),
      replacedInViewer: false,
      capabilities: {
        kind: 'generic',
      },
    };
  }
}

