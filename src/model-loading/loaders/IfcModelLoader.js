import { IfcService } from "../../ifc/IfcService.js";

/**
 * IFC loader adapter.
 *
 * Notes:
 * - Reuses existing IfcService (for stability and to keep IFC-specific capabilities intact).
 * - IfcService currently integrates with Viewer internally via viewer.replaceWithModel().
 *   Therefore, this loader returns replacedInViewer=true to prevent double replace.
 */
export class IfcModelLoader {
  /**
   * @param {IfcService|null} ifcService - optional externally managed service
   */
  constructor(ifcService = null) {
    this.id = 'ifc';
    this.extensions = ['.ifc', '.ifs', '.ifczip', '.zip'];
    /** @type {IfcService|null} */
    this._ifc = ifcService;
  }

  /**
   * @param {any} ctx
   * @returns {IfcService}
   */
  _getService(ctx) {
    if (this._ifc) return this._ifc;
    const viewer = ctx?.viewer;
    if (!viewer) throw new Error('IfcModelLoader: ctx.viewer is required');
    const wasmUrl = ctx?.wasmUrl || null;
    const svc = new IfcService(viewer, wasmUrl);
    svc.init();
    this._ifc = svc;
    return svc;
  }

  /**
   * @param {File} file
   * @param {any} ctx
   */
  async loadFile(file, ctx) {
    const ifc = this._getService(ctx);
    const model = await ifc.loadFile(file);
    if (!model) throw new Error('IFC loadFile returned null');
    return {
      object3D: model,
      format: this.id,
      name: file?.name || '',
      replacedInViewer: true,
      capabilities: {
        kind: 'ifc',
        ifcService: ifc,
      },
    };
  }

  /**
   * @param {string} url
   * @param {any} ctx
   */
  async loadUrl(url, ctx) {
    const ifc = this._getService(ctx);
    const model = await ifc.loadUrl(url);
    if (!model) throw new Error('IFC loadUrl returned null');
    return {
      object3D: model,
      format: this.id,
      name: String(url || ''),
      replacedInViewer: true,
      capabilities: {
        kind: 'ifc',
        ifcService: ifc,
      },
    };
  }
}

