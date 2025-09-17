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
   * Возвращает пространственную структуру IFC (иерархия) для активной модели
   * Структура: { expressID, type, children: [...] }
   */
  async getSpatialStructure(modelID) {
    if (!this.loader) this.init();
    const mgr = this.loader.ifcManager;
    if (!mgr) return null;
    try {
      // Если ID не указан, возьмём первый доступный
      const all = mgr.ifcModels || [];
      const mdl = modelID != null ? all.find(m => m.modelID === modelID) : all[0];
      if (!mdl) return null;
      const structure = await mgr.getSpatialStructure(mdl.modelID, true);
      return structure;
    } catch (e) {
      console.error("getSpatialStructure error", e);
      return null;
    }
  }

  /**
   * Загружает файл IFC/IFCZIP из File и добавляет в сцену
   * @param {File} file
   */
  async loadFile(file) {
    if (!this.loader) this.init();
    // Проверка расширения: поддерживаются .ifc и .ifczip
    const name = (file?.name || "").toLowerCase();
    const isIFC = name.endsWith(".ifc");
    const isIFS = name.endsWith(".ifs");
    const isZIP = name.endsWith(".ifczip") || name.endsWith(".zip");
    if (!isIFC && !isIFS && !isZIP) {
      alert("Формат не поддерживается. Используйте .ifc, .ifs или .ifczip");
      return null;
    }
    const url = URL.createObjectURL(file);
    try {
      const model = await this.loader.loadAsync(url);
      // Показать модель вместо демо-куба
      if (this.viewer.replaceWithModel) this.viewer.replaceWithModel(model);
      if (this.viewer.focusObject) this.viewer.focusObject(model);
      return model;
    } catch (err) {
      console.error("IFC load error:", err);
      alert("Ошибка загрузки IFC: " + (err?.message || err));
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  dispose() {
    if (this.loader?.ifcManager) this.loader.ifcManager.dispose();
    this.loader = null;
  }
}


