import { Mesh, MeshStandardMaterial } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/**
 * STL loader (ASCII/Binary).
 *
 * Notes:
 * - STL usually has no material/color information -> we apply a default material.
 * - If normals are missing, we compute vertex normals.
 */
export class StlModelLoader {
  /**
   * @param {{ rotateXNeg90?: boolean }} [options]
   * rotateXNeg90:
   * - Some STL assets are authored Z-up; viewer is Y-up. This rotates into Y-up.
   */
  constructor(options = {}) {
    this.id = 'stl';
    this.extensions = ['.stl'];
    this._loader = new STLLoader();
    this._rotateXNeg90 = options.rotateXNeg90 !== false; // default true
  }

  /**
   * @param {File} file
   * @param {any} ctx
   */
  async loadFile(file, ctx) {
    const logger = ctx?.logger || console;
    const name = file?.name || '';
    logger?.log?.('[StlModelLoader] loadFile', { name, size: file?.size });

    const buf = await file.arrayBuffer();
    const geom = this._loader.parse(buf);
    const mesh = this._makeMesh(geom);
    // Axis fix BEFORE Viewer.replaceWithModel(): ensures bbox/shadowReceiver computed correctly.
    if (this._rotateXNeg90) {
      try {
        mesh.rotation.x = -Math.PI / 2;
        mesh.updateMatrixWorld?.(true);
      } catch (_) {}
    }

    try {
      logger?.log?.('[StlModelLoader] parsed', {
        name,
        triangles: (geom?.index ? (geom.index.count / 3) : (geom?.attributes?.position ? (geom.attributes.position.count / 3) : undefined)),
        hasNormals: !!geom?.attributes?.normal,
      });
    } catch (_) {}

    return {
      object3D: mesh,
      format: this.id,
      name,
      replacedInViewer: false,
      capabilities: { kind: 'generic' },
    };
  }

  /**
   * @param {string} url
   * @param {any} ctx
   */
  async loadUrl(url, ctx) {
    const logger = ctx?.logger || console;
    logger?.log?.('[StlModelLoader] loadUrl', { url });
    const geom = await this._loader.loadAsync(url);
    const mesh = this._makeMesh(geom);
    if (this._rotateXNeg90) {
      try {
        mesh.rotation.x = -Math.PI / 2;
        mesh.updateMatrixWorld?.(true);
      } catch (_) {}
    }
    return {
      object3D: mesh,
      format: this.id,
      name: String(url || ''),
      replacedInViewer: false,
      capabilities: { kind: 'generic' },
    };
  }

  _makeMesh(geometry) {
    const geom = geometry;
    try {
      if (geom && !geom.attributes?.normal) geom.computeVertexNormals?.();
      geom.computeBoundingBox?.();
    } catch (_) {}

    const mat = new MeshStandardMaterial({
      color: 0xb0b0b0,
      roughness: 0.85,
      metalness: 0.0,
    });
    const mesh = new Mesh(geom, mat);
    mesh.name = 'stl-mesh';
    return mesh;
  }
}

