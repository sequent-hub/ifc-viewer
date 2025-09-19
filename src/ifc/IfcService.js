// Сервис загрузки IFC моделей и добавления их в сцену three.js
// Требует three@^0.149 и web-ifc-three совместимой версии

import { IFCLoader } from "web-ifc-three/IFCLoader.js";
// Примечание: IFCWorker не используется, так как мы отключаем Web Workers
// для стабильности работы в различных окружениях

// Патч совместимости будет применен после инициализации WASM

export class IfcService {
  /**
   * @param {import('../viewer/Viewer').Viewer} viewer
   * @param {string} [wasmUrl] - URL для загрузки WASM файла web-ifc
   */
  constructor(viewer, wasmUrl = null) {
    this.viewer = viewer;
    this.wasmUrl = wasmUrl;
    this.loader = null;
    this.lastModel = null; // THREE.Object3D модели IFC
    this.lastFileName = null;
    this.selectionMaterial = null;
    this.selectionCustomID = 'ifc-selection';
    this.isolateMode = false;
  }

  init() {
    try {
      this.loader = new IFCLoader();
      // Отключаем Web Workers: парсим в главном потоке для стабильности
      // Это предотвращает проблемы с загрузкой IFCWorker в различных окружениях
      try { 
        this.loader.ifcManager.useWebWorkers?.(false);
        console.log('IfcService: Web Workers отключены, парсинг в главном потоке');
      } catch (error) {
        console.warn('IfcService: не удалось отключить Web Workers:', error.message);
      }
      
      // Настройка пути к WASM файлу с улучшенной обработкой ошибок
      this._setupWasmPath();
      
      // Настройка конфигурации web-ifc
      this._setupWebIfcConfig();
      
      // Применяем патч совместимости Three.js после успешной инициализации
      this._applyThreeJsPatch();
      
    } catch (error) {
      console.error('IfcService: критическая ошибка инициализации:', error);
      this._handleCriticalError(error);
    }
  }

  /**
   * Настройка пути к WASM файлу с fallback
   * @private
   */
  _setupWasmPath() {
    const wasmPaths = this._getWasmPaths();
    
    for (let i = 0; i < wasmPaths.length; i++) {
      try {
        this.loader.ifcManager.setWasmPath(wasmPaths[i]);
        console.log(`IfcService: WASM путь установлен: ${wasmPaths[i]}`);
        return; // Успешно установлен
      } catch (error) {
        console.warn(`IfcService: не удалось установить WASM путь ${wasmPaths[i]}:`, error.message);
        if (i === wasmPaths.length - 1) {
          // Последний путь тоже не сработал
          throw new Error('Все пути к WASM файлу недоступны');
        }
      }
    }
  }

  /**
   * Получает список путей к WASM файлу в порядке приоритета
   * @private
   */
  _getWasmPaths() {
    const paths = [];
    
    // 1. Пользовательский путь (если указан)
    if (this.wasmUrl) {
      paths.push(this.wasmUrl);
    }
    
    // 2. Популярные пути по умолчанию (в порядке приоритета)
    paths.push(
      '/node_modules/web-ifc/web-ifc.wasm', // Прямо из node_modules (самый надежный)
      '/wasm/web-ifc.wasm',           // Стандартный путь в public/wasm/
      '/web-ifc.wasm',                // Корневой путь
      './web-ifc.wasm',               // Относительный путь
      'web-ifc.wasm'                  // Просто имя файла
    );
    
    return paths;
  }

  /**
   * Настройка конфигурации web-ifc
   * @private
   */
  _setupWebIfcConfig() {
    try {
      this.loader.ifcManager.applyWebIfcConfig?.({
        COORDINATE_TO_ORIGIN: true,
        USE_FAST_BOOLS: true,
        // Порог игнорирования очень мелких полигонов (уменьшаем шум)
        SMALL_TRIANGLE_THRESHOLD: 1e-9,
      });
    } catch (error) {
      console.warn('IfcService: не удалось применить конфигурацию web-ifc:', error.message);
    }
  }

  /**
   * Применяет патч совместимости для Three.js 0.149+
   * @private
   */
  _applyThreeJsPatch() {
    try {
      // Динамически импортируем патч совместимости
      import('../compat/three-compat-patch.js').then(() => {
        console.log('✅ IfcService: Патч совместимости Three.js применен');
      }).catch(error => {
        console.warn('IfcService: не удалось применить патч совместимости:', error.message);
      });
    } catch (error) {
      console.warn('IfcService: ошибка при применении патча совместимости:', error.message);
    }
  }

  /**
   * Обработка критических ошибок инициализации
   * @private
   */
  _handleCriticalError(error) {
    // Создаем заглушку для loader, чтобы избежать падения
    this.loader = {
      ifcManager: {
        setWasmPath: () => {},
        applyWebIfcConfig: () => {},
        useWebWorkers: () => {},
        load: () => Promise.reject(new Error('WASM не инициализирован'))
      }
    };
    
    // Уведомляем о критической ошибке
    this.viewer?.container?.dispatchEvent(new CustomEvent('ifcviewer:error', {
      detail: { 
        error: new Error('Критическая ошибка инициализации WASM: ' + error.message),
        type: 'wasm_init_error'
      }
    }));
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
    try {
      if (!this.loader) this.init();
      
      // Проверка расширения: поддерживаются .ifc и .ifczip
      const name = (file?.name || "").toLowerCase();
      const isIFC = name.endsWith(".ifc");
      const isIFS = name.endsWith(".ifs");
      const isZIP = name.endsWith(".ifczip") || name.endsWith(".zip");
      if (!isIFC && !isIFS && !isZIP) {
        throw new Error("Формат не поддерживается. Используйте .ifc, .ifs или .ifczip");
      }
      
      const url = URL.createObjectURL(file);
      try {
        const model = await this._loadModelWithFallback(url);
        // Показать модель вместо демо-куба
        if (this.viewer.replaceWithModel) this.viewer.replaceWithModel(model);
        if (this.viewer.focusObject) this.viewer.focusObject(model);
        this.lastModel = model;
        this.lastFileName = file?.name || null;
        // Сообщим, что модель загружена
        this._dispatchModelLoaded(model);
        return model;
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("IFC load error:", err);
      this._handleLoadError(err, 'loadFile');
      return null;
    }
  }

  /**
   * Загружает модель IFC по URL (например, из /public/ifc/...)
   * @param {string} url
   */
  async loadUrl(url) {
    try {
      if (!this.loader) this.init();
      if (!url) return null;
      
      const model = await this._loadModelWithFallback(url);
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
      this._dispatchModelLoaded(model);
      return model;
    } catch (err) {
      console.error("IFC loadUrl error:", err);
      this._handleLoadError(err, 'loadUrl');
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

  /**
   * Загружает модель с fallback обработкой ошибок WASM
   * @private
   */
  async _loadModelWithFallback(url) {
    try {
      return await this.loader.loadAsync(url);
    } catch (error) {
      // Проверяем, связана ли ошибка с WASM
      if (this._isWasmError(error)) {
        console.warn('IfcService: обнаружена ошибка WASM, пытаемся переинициализировать...');
        await this._reinitializeWithFallback();
        // Повторная попытка загрузки
        return await this.loader.loadAsync(url);
      }
      throw error;
    }
  }

  /**
   * Проверяет, связана ли ошибка с WASM
   * @private
   */
  _isWasmError(error) {
    const message = error?.message?.toLowerCase() || '';
    return message.includes('wasm') || 
           message.includes('webassembly') ||
           message.includes('module') ||
           message.includes('instantiate');
  }

  /**
   * Переинициализирует loader с fallback путями
   * @private
   */
  async _reinitializeWithFallback() {
    try {
      // Попробуем переинициализировать с другими путями
      this.loader = new IFCLoader();
      this._setupWasmPath();
      this._setupWebIfcConfig();
    } catch (error) {
      console.error('IfcService: не удалось переинициализировать:', error);
      throw new Error('Критическая ошибка WASM: невозможно загрузить модель');
    }
  }

  /**
   * Отправляет событие о загрузке модели
   * @private
   */
  _dispatchModelLoaded(model) {
    try {
      document.dispatchEvent(new CustomEvent('ifc:model-loaded', { 
        detail: { modelID: model.modelID } 
      }));
    } catch (_) {}
  }

  /**
   * Обрабатывает ошибки загрузки
   * @private
   */
  _handleLoadError(error, method) {
    const errorMessage = `Ошибка загрузки IFC (${method}): ${error?.message || error}`;
    
    // Отправляем событие об ошибке
    this.viewer?.container?.dispatchEvent(new CustomEvent('ifcviewer:error', {
      detail: { 
        error: new Error(errorMessage),
        type: 'load_error',
        method: method
      }
    }));
    
    // Показываем пользователю понятное сообщение
    const userMessage = this._getUserFriendlyMessage(error);
    alert(userMessage);
  }

  /**
   * Возвращает понятное пользователю сообщение об ошибке
   * @private
   */
  _getUserFriendlyMessage(error) {
    const message = error?.message?.toLowerCase() || '';
    
    if (message.includes('wasm') || message.includes('webassembly')) {
      return 'Ошибка загрузки WASM модуля. Проверьте доступность файла web-ifc.wasm';
    }
    
    if (message.includes('network') || message.includes('fetch')) {
      return 'Ошибка сети при загрузке файла. Проверьте подключение к интернету';
    }
    
    if (message.includes('format') || message.includes('parse')) {
      return 'Ошибка формата файла. Убедитесь, что файл является корректным IFC файлом';
    }
    
    return `Ошибка загрузки модели: ${error?.message || 'Неизвестная ошибка'}`;
  }
}


