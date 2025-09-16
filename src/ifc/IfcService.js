// Сервис загрузки IFC моделей и добавления их в сцену three.js
// Требует three@^0.149 и web-ifc-three совместимой версии

import { IFCLoader } from "web-ifc-three/IFCLoader";

export class IfcService {
  /**
   * @param {import('../viewer/Viewer').Viewer} viewer
   */
  constructor(viewer) {
    this.viewer = viewer;
    this.loader = null;
  }

  init() {
    this.loader = new IFCLoader();
    // Путь к wasm файлу (скопируйте web-ifc.wasm в public/wasm)
    this.loader.ifcManager.setWasmPath("/wasm/");
  }

  /**
   * Загружает файл IFC/IFCZIP из File и добавляет в сцену
   * @param {File} file
   */
  async loadFile(file) {
    if (!this.loader) this.init();
    const url = URL.createObjectURL(file);
    try {
      const model = await this.loader.loadAsync(url);
      this.viewer.scene.add(model);
      if (this.viewer.focusObject) this.viewer.focusObject(model);
      return model;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  dispose() {
    if (this.loader?.ifcManager) this.loader.ifcManager.dispose();
    this.loader = null;
  }
}


