// Сервис загрузки IFC моделей и добавления их в сцену three.js
// Требует three@^0.149 и web-ifc-three совместимой версии

import { IFCLoader } from "web-ifc-three/IFCLoader";
// Абсолютный URL до wasm-асета из папки public (Vite подставит корректный путь)
import WEBIFC_WASM_URL from '/wasm/web-ifc.wasm?url';
// URL собранного воркера через Vite (даёт корректный путь для useWebWorkers)
// Важно: используем ?url, чтобы получить сырой URL ассета и создать классический Worker,
// т.к. web-ifc-three создаёт воркер без { type: 'module' }
import IFCWorkerUrl from 'web-ifc-three/IFCWorker.js?url';

export class IfcService {
  /**
   * @param {import('../viewer/Viewer').Viewer} viewer
   */
  constructor(viewer) {
    this.viewer = viewer;
    this.loader = null;
    this.lastModel = null; // THREE.Object3D модели IFC
    this.lastFileName = null;
    this.selectionMaterial = null;
    this.selectionCustomID = 'ifc-selection';
    this.isolateMode = false;
  }

  init() {
    this.loader = new IFCLoader();
    // Отключаем Web Worker: временно парсим в главном потоке для стабильности
    try { this.loader.ifcManager.useWebWorkers?.(false); } catch(_) {}
    // Путь к wasm файлу (скопируйте web-ifc.wasm в public/wasm)
    try {
      // Преобразуем URL файла wasm в URL каталога и передадим в воркер
      const wasmDir = new URL('.', WEBIFC_WASM_URL).href;
      this.loader.ifcManager.setWasmPath(wasmDir);
      // Дополнительно подстрахуемся передачей полного файла, если версия это поддерживает
      try { this.loader.ifcManager.setWasmPath(WEBIFC_WASM_URL); } catch(_) {}
    } catch (_) {
      this.loader.ifcManager.setWasmPath('/wasm/');
    }
    try {
      this.loader.ifcManager.applyWebIfcConfig?.({
        COORDINATE_TO_ORIGIN: true,
        USE_FAST_BOOLS: true,
        // Порог игнорирования очень мелких полигонов (уменьшаем шум)
        // Некоторые сборки поддерживают SMALL_TRIANGLE_THRESHOLD
        SMALL_TRIANGLE_THRESHOLD: 1e-9,
      });
    } catch(_) {}
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
      // Определим корректный modelID надёжно
      const id = modelID != null ? modelID : (this.lastModel?.modelID);
      if (id == null) return null;
      // Во многих версиях getSpatialStructure синхронен; await совместим с обоими случаями
      const structure = await mgr.getSpatialStructure(id, true);
      return structure;
    } catch (e) {
      console.error("getSpatialStructure error", e);
      return null;
    }
  }

  /**
   * Собирает плоский список узлов из пространственной структуры
   * Возвращает массив объектов { expressID, type }
   */
  async flattenSpatialStructure(modelID) {
    const structure = await this.getSpatialStructure(modelID);
    if (!structure) return [];
    const out = [];
    const stack = [structure];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      if (n.expressID != null) out.push({ expressID: n.expressID, type: n.type || '' });
      const ch = Array.isArray(n.children) ? n.children : [];
      for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
    }
    return out;
  }

  /**
   * Формирует тестовый дамп свойств: для первых limit элементов
   * возвращает { total, count, limit, items: [{ id, type, props, psets }] }
   */
  async dumpAllProperties(limit = 200, modelID) {
    if (!this.loader) this.init();
    const mgr = this.loader.ifcManager;
    if (!mgr) return { total: 0, count: 0, limit, items: [] };
    const id = modelID != null ? modelID : (this.lastModel?.modelID);
    if (id == null) return { total: 0, count: 0, limit, items: [] };

    const flat = await this.flattenSpatialStructure(id);
    const total = flat.length;
    const slice = flat.slice(0, Math.max(0, limit | 0));
    const items = [];
    for (const entry of slice) {
      const eid = entry.expressID;
      let props = null;
      let psets = [];
      try { props = await mgr.getItemProperties(id, eid, true); } catch (_) { props = null; }
      try { psets = await mgr.getPropertySets(id, eid, true); } catch (_) { psets = []; }
      items.push({ id: eid, type: entry.type || '', props, psets });
    }
    return { total, count: items.length, limit, items };
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
      this.lastModel = model;
      this.lastFileName = file?.name || null;
      // Сообщим, что модель загружена
      try { document.dispatchEvent(new CustomEvent('ifc:model-loaded', { detail: { modelID: model.modelID } })); } catch(_) {}
      return model;
    } catch (err) {
      console.error("IFC load error:", err);
      alert("Ошибка загрузки IFC: " + (err?.message || err));
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Загружает модель IFC по URL (например, из /public/ifc/...)
   * @param {string} url
   */
  async loadUrl(url) {
    if (!this.loader) this.init();
    if (!url) return null;
    try {
      // Защитим загрузку: перехватим возможные исключения на уровне воркера
      const model = await this.loader.loadAsync(url);
      if (!model || !model.geometry) throw new Error('IFC model returned without geometry');
      if (this.viewer.replaceWithModel) this.viewer.replaceWithModel(model);
      if (this.viewer.focusObject) this.viewer.focusObject(model);
      this.lastModel = model;
      try {
        // Показать имя файла из URL
        const u = new URL(url, window.location.origin);
        this.lastFileName = decodeURIComponent(u.pathname.split('/').pop() || url);
      } catch (_) {
        this.lastFileName = url;
      }
      // Сообщим, что модель загружена
      try { document.dispatchEvent(new CustomEvent('ifc:model-loaded', { detail: { modelID: model.modelID } })); } catch(_) {}
      return model;
    } catch (err) {
      console.error("IFC loadUrl error:", err);
      alert("Ошибка загрузки IFC по URL: " + (err?.message || err));
      return null;
    }
  }

  getLastInfo() {
    const name = this.lastFileName || "";
    const id = this.lastModel?.modelID != null ? String(this.lastModel.modelID) : "";
    return { name, modelID: id };
  }

  dispose() {
    if (this.loader?.ifcManager) this.loader.ifcManager.dispose();
    this.loader = null;
  }

  setIsolateMode(enabled) {
    this.isolateMode = !!enabled;
    if (!enabled) {
      // Вернуть модель, если выключили изоляцию
      if (this.lastModel) this.lastModel.visible = true;
    }
  }

  /** Возвращает массив expressID всех элементов в поддереве */
  collectElementIDsFromStructure(node) {
    const ids = [];
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      const hasChildren = Array.isArray(n.children) && n.children.length > 0;
      if (hasChildren) {
        for (const c of n.children) stack.push(c);
      } else if (n.expressID != null) {
        ids.push(n.expressID);
      }
    }
    return ids;
  }

  async highlightByIds(ids) {
    if (!this.loader || !this.viewer || !this.lastModel) return;
    const mgr = this.loader.ifcManager;
    if (!mgr) return;
    const modelID = this.lastModel.modelID;
    const scene = this.viewer.scene;
    if (!scene) return;

    // Очистить предыдущую подсветку
    try { mgr.removeSubset(modelID, this.selectionCustomID); } catch (_) { /* older api? */ }
    try { mgr.removeSubset({ modelID, customID: this.selectionCustomID }); } catch (_) {}

    if (!ids || !ids.length) {
      if (this.lastModel) this.lastModel.visible = true;
      return;
    }

    if (!this.selectionMaterial) {
      const THREEmod = await import('three');
      this.selectionMaterial = new THREEmod.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.9, depthTest: true });
    }
    const idsInt = ids.map((x) => (typeof x === 'number' ? x : parseInt(x, 10))).filter((v) => Number.isFinite(v));
    if (!idsInt.length) return;

    // Создать сабсет
    let subset = null;
    let ok = false;
    try {
      subset = mgr.createSubset(scene, modelID, idsInt, this.selectionMaterial, true, this.selectionCustomID);
      ok = true;
    } catch (_) {
      // новая сигнатура
      try {
        subset = mgr.createSubset({ modelID, ids: idsInt, material: this.selectionMaterial, scene, removePrevious: true, customID: this.selectionCustomID });
        ok = true;
      } catch (_) {}
    }
    if (!ok) return;

    // Изоляция: скрыть базовую модель, оставить только подсветку
    if (this.isolateMode && this.lastModel) {
      this.lastModel.visible = false;
      if (subset) subset.visible = true;
    } else if (this.lastModel) {
      this.lastModel.visible = true;
    }
  }
}


