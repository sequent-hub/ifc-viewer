/**
 * Класс IfcViewer - основная точка входа для просмотра IFC моделей
 * Инкапсулирует всю логику создания и управления 3D просмотрщиком
 * 
 * Пример использования:
 * const viewer = new IfcViewer({
 *   container: document.getElementById('modal-content'),
 *   ifcUrl: '/path/to/model.ifc'
 * })
 * await viewer.init()
 */

import { Viewer } from "./viewer/Viewer.js";
import { IfcService } from "./ifc/IfcService.js";
import { IfcTreeView } from "./ifc/IfcTreeView.js";
import './style.css';


export class IfcViewer {
  /**
   * Создаёт новый экземпляр IfcViewer
   * @param {Object} options - Параметры конфигурации
   * @param {HTMLElement|string} options.container - Контейнер для рендера (элемент или селектор)
   * @param {string} [options.ifcUrl] - URL для загрузки IFC файла
   * @param {File} [options.ifcFile] - File объект для загрузки IFC файла
   * @param {string} [options.wasmUrl] - URL для загрузки WASM файла web-ifc
   * @param {boolean} [options.useTestPreset=true] - Включать ли пресет "Тест" по умолчанию (рекомендованные тени/визуал)
   * @param {boolean} [options.showSidebar=false] - Показывать ли боковую панель с деревом
   * @param {boolean} [options.showControls=false] - Показывать ли панель управления (нижние кнопки)
   * @param {boolean} [options.showToolbar=true] - Показывать ли верхнюю панель инструментов
   * @param {boolean} [options.autoLoad=true] - Автоматически загружать IFC файл при инициализации
   * @param {string} [options.theme='light'] - Тема интерфейса ('light' | 'dark')
   * @param {Object} [options.viewerOptions] - Дополнительные опции для Viewer
   */
  constructor(options = {}) {
    // Валидация параметров
    if (!options.container) {
      throw new Error('IfcViewer: параметр container обязателен');
    }

    // Получение контейнера
    this.containerElement = typeof options.container === 'string' 
      ? document.querySelector(options.container)
      : options.container;
      
    if (!this.containerElement) {
      throw new Error('IfcViewer: контейнер не найден');
    }

    // Сохранение конфигурации
    this.options = {
      ifcUrl: options.ifcUrl || null,
      ifcFile: options.ifcFile || null,
      wasmUrl: options.wasmUrl || null,
      // По умолчанию включаем пресет "Тест" для корректного вида теней (как в демо-настройках)
      useTestPreset: options.useTestPreset !== false,
      showSidebar: options.showSidebar === true, // по умолчанию false
      showControls: options.showControls === true, // по умолчанию false
      showToolbar: options.showToolbar !== false, // по умолчанию true
      autoLoad: options.autoLoad !== false,
      theme: options.theme || 'light',
      viewerOptions: options.viewerOptions || {}
    };

    // Внутренние компоненты
    this.viewer = null;
    this.ifcService = null;
    this.ifcTreeView = null;
    this.isInitialized = false;
    this.currentModel = null;

    // DOM элементы интерфейса
    this.elements = {
      viewerContainer: null,
      sidebar: null,
      controls: null,
      uploadInput: null
    };

    // Слушатели событий для очистки
    this.eventListeners = new Map();

    // Внутренние состояния управления
    this.viewerState = {
      quality: 'medium', // 'low' | 'medium' | 'high'
      edgesVisible: false,
      flatShading: true,
      shadowsEnabled: true,
      clipping: {
        x: false,
        y: false,
        z: false,
        active: null // текущая активная ось
      }
    };
  }

  /**
   * Инициализирует просмотрщик и создаёт интерфейс
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      console.warn('IfcViewer: уже инициализирован');
      return;
    }

    try {
      // Создаём разметку интерфейса
      this._createInterface();
      
      // Применяем тему
      this._applyTheme();

      // Инициализируем компоненты
      this._initViewer();
      this._initIfcService();
      this._initTreeView();

      // Применяем дефолтный пресет пакета (полностью независим от index.html)
      // Важно: пресет должен примениться ДО загрузки модели, чтобы настройки подхватились при replaceWithModel()
      if (this.options.useTestPreset && this.viewer?.setTestPresetEnabled) {
        this.viewer.setTestPresetEnabled(true);
      }
      
      // Настраиваем обработчики событий
      this._setupEventHandlers();

      // Автозагрузка файла если указан
      if (this.options.autoLoad && (this.options.ifcUrl || this.options.ifcFile)) {
        await this.loadModel();
      }

      this.isInitialized = true;
      
      // Диспетчируем событие готовности
      this._dispatchEvent('ready', { viewer: this });
      
    } catch (error) {
      console.error('IfcViewer: ошибка инициализации', error);
      throw error;
    }
  }

  /**
   * Загружает IFC модель из URL или File
   * @param {string|File} [source] - Источник модели (URL или File). Если не указан, использует из options
   * @returns {Promise<Object|null>} - Загруженная модель или null при ошибке
   */
  async loadModel(source) {
    if (!this.ifcService) {
      throw new Error('IfcViewer: не инициализирован. Вызовите init() сначала');
    }

    try {
      let model = null;
      const loadSource = source || this.options.ifcUrl || this.options.ifcFile;
      
      if (!loadSource) {
        throw new Error('Не указан источник IFC модели');
      }

      // Показываем прелоадер если есть
      this._showPreloader();

      // Загружаем модель в зависимости от типа источника
      if (typeof loadSource === 'string') {
        model = await this.ifcService.loadUrl(loadSource);
      } else if (loadSource instanceof File) {
        model = await this.ifcService.loadFile(loadSource);
      } else {
        throw new Error('Неподдерживаемый тип источника модели');
      }

      if (model) {
        this.currentModel = model;
        
        // Обновляем дерево структуры
        await this._updateTreeView(model);
        
        // Обновляем информационную панель
        this._updateInfoPanel();
        
        // Показываем сайдбар при успешной загрузке
        if (this.options.showSidebar) {
          this._setSidebarVisible(true);
        }
        
        // Диспетчируем событие загрузки модели
        this._dispatchEvent('model-loaded', { model, viewer: this });
      }

      this._hidePreloader();
      return model;

    } catch (error) {
      console.error('IfcViewer: ошибка загрузки модели', error);
      this._hidePreloader();
      this._dispatchEvent('error', { error, viewer: this });
      return null;
    }
  }

  /**
   * Освобождает ресурсы и очищает интерфейс
   */
  dispose() {
    if (!this.isInitialized) return;

    // Очищаем слушатели событий
    this.eventListeners.forEach((listener, key) => {
      const [element, event] = key.split('.');
      const el = element === 'document' ? document : 
                 element === 'window' ? window : this.elements[element];
      if (el && listener) {
        el.removeEventListener(event, listener);
      }
    });
    this.eventListeners.clear();

    // Освобождаем компоненты
    if (this.ifcService) {
      this.ifcService.dispose();
      this.ifcService = null;
    }
    
    if (this.viewer) {
      this.viewer.dispose();
      this.viewer = null;
    }

    // Очищаем DOM
    if (this.containerElement) {
      this.containerElement.innerHTML = '';
    }

    this.isInitialized = false;
    this.currentModel = null;
    
    // Диспетчируем событие освобождения ресурсов
    this._dispatchEvent('disposed', { viewer: this });
  }

  /**
   * Получает информацию о текущей модели
   * @returns {Object|null} Информация о модели или null
   */
  getModelInfo() {
    if (!this.ifcService) return null;
    return this.ifcService.getLastInfo();
  }

  /**
   * Получает экземпляр Viewer для прямого доступа к функциям просмотра
   * @returns {Viewer|null}
   */
  getViewer() {
    return this.viewer;
  }

  /**
   * Получает экземпляр IfcService для работы с IFC данными
   * @returns {IfcService|null}
   */
  getIfcService() {
    return this.ifcService;
  }

  /**
   * Устанавливает видимость боковой панели
   * @param {boolean} visible - Показать или скрыть
   */
  setSidebarVisible(visible) {
    this._setSidebarVisible(visible);
  }

  /**
   * Переключает тему интерфейса
   * @param {string} theme - Новая тема ('light' | 'dark')
   */
  setTheme(theme) {
    this.options.theme = theme;
    this._applyTheme();
  }

  // ==================== ПРИВАТНЫЕ МЕТОДЫ ====================

  /**
   * Создаёт HTML разметку интерфейса
   * @private
   */
  _createInterface() {
    // Основная разметка просмотрщика
    const html = `
      <div class="ifc-viewer-container" style="width: 100%; height: 100%; position: relative; display: flex; flex-direction: column; border:0px red solid;">
       <!-- Прелоадер -->
        <div id="ifcPreloader" class="absolute inset-0 bg-base-100 flex items-center justify-center z-50">
          <div class="text-center">
            <span class="loading loading-spinner loading-lg"></span>
            <div class="mt-2 text-sm opacity-70">Загрузка модели...</div>
          </div>
        </div>

        <!-- Верхняя панель управления -->
        <div id="ifcToolbar" class="d-flex px-4" style="border:0px red solid; width: 350px; position: absolute; z-index: 60; justify-content:space-between;  bottom: 10px; left: calc(50% - 175px); ">
          
          <div class="navbar-end flex gap-2">                   
            
            <!-- Стили отображения -->
            <div class="join">
              <button class="btn btn-sm join-item" id="ifcToggleEdges"><svg width="24" height="24" xmlns="http://www.w3.org/2000/svg" class="c-tree__icon c-tree__icon--3d"><g fill="#252A3F" fill-rule="nonzero"><path d="M12.5 5L6.005 8.75v7.5L12.5 20l6.495-3.75v-7.5L12.5 5zm0-1.155l7.495 4.328v8.654L12.5 21.155l-7.495-4.328V8.173L12.5 3.845z"></path><path d="M12 12v8.059h1V12z"></path><path d="M5.641 9.157l7.045 4.025.496-.868-7.045-4.026z"></path><path d="M18.863 8.288l-7.045 4.026.496.868 7.045-4.025z"></path></g></svg></button>              
              <button class="btn btn-sm join-item btn-active" id="ifcToggleShadows" title="Тени">
                <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#000000" d="M207.39 0.00 C 212.56 0.44 217.91 0.57 222.85 1.13 C 262.70 5.63 300.04 25.42 325.92 56.02 Q 361.61 98.22 364.04 153.58 A 0.23 0.22 11.8 0 1 363.71 153.79 L 349.62 146.87 A 0.90 0.90 0.0 0 1 349.13 146.22 C 347.61 137.34 346.80 130.78 344.73 123.45 C 332.00 78.38 299.83 39.42 256.32 20.94 C 235.21 11.97 211.55 8.21 189.00 11.72 Q 153.18 17.30 128.20 42.72 Q 110.60 60.63 102.05 85.78 C 88.10 126.83 95.83 172.91 118.73 209.60 Q 122.30 215.32 127.44 222.49 A 1.70 1.70 0.0 0 1 127.76 223.45 L 128.09 298.58 A 0.23 0.23 0.0 0 1 127.75 298.78 C 82.71 273.41 52.38 228.77 46.61 177.37 C 41.26 129.73 57.69 81.88 91.39 47.83 Q 129.76 9.07 184.30 1.42 C 189.99 0.63 196.32 0.47 202.38 0.00 L 207.39 0.00 Z"/>
                  <path fill="#000000" d="M312.50 512.00 L 311.56 512.00 Q 309.05 511.43 307.15 509.96 A 2.09 2.07 -19.8 0 0 306.27 509.55 Q 304.17 509.09 303.52 508.75 Q 206.21 457.82 153.89 430.39 Q 152.01 429.41 151.14 427.04 Q 150.58 425.52 150.56 422.64 Q 150.42 393.12 149.69 237.76 Q 149.69 236.82 150.36 233.09 Q 150.86 230.31 153.63 228.87 Q 250.38 178.34 303.97 150.48 Q 307.28 148.76 310.46 150.29 Q 339.28 164.17 462.71 224.01 Q 466.51 225.85 466.51 230.76 Q 466.50 321.20 466.49 424.75 C 466.49 428.40 464.08 430.42 460.80 432.20 Q 425.93 451.10 315.52 510.97 A 0.87 0.80 -65.8 0 1 315.31 511.06 L 312.50 512.00 Z M 444.21 230.96 A 0.32 0.32 0.0 0 0 444.19 230.39 L 307.84 163.41 A 0.32 0.32 0.0 0 0 307.55 163.42 L 171.77 234.43 A 0.32 0.32 0.0 0 0 171.78 235.00 L 311.71 304.85 A 0.32 0.32 0.0 0 0 312.01 304.85 L 444.21 230.96 Z M 318.55 493.80 A 0.34 0.34 0.0 0 0 319.05 494.10 L 453.17 421.35 A 0.34 0.34 0.0 0 0 453.35 421.05 L 453.35 241.55 A 0.34 0.34 0.0 0 0 452.84 241.25 L 318.72 316.20 A 0.34 0.34 0.0 0 0 318.55 316.50 L 318.55 493.80 Z"/>
                </svg>
              </button>
              <button class="btn btn-sm join-item" id="ifcToggleProjection" title="Перспектива / Ортогонально (переключение)">
                <!-- По умолчанию Ortho, поэтому показываем действие: включить Perspective -->
                <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#000000" d="M365.50 333.29 A 0.30 0.30 0.0 0 0 365.95 333.55 L 492.36 259.80 A 0.47 0.47 0.0 0 0 492.51 259.12 Q 489.74 255.31 492.90 252.78 A 0.30 0.30 0.0 0 0 492.83 252.27 C 489.14 250.57 490.13 245.43 493.90 244.50 C 496.33 243.90 501.93 247.88 504.97 249.79 A 1.50 1.48 -85.3 0 1 505.54 250.47 L 505.97 251.53 A 0.72 0.71 76.6 0 0 506.67 251.97 C 509.70 251.84 512.28 254.84 511.15 257.67 Q 510.77 258.62 508.18 260.14 C 355.38 349.68 251.70 410.06 149.28 469.74 A 3.94 3.93 -44.9 0 1 145.31 469.74 Q 7.70 389.45 2.96 386.69 C 0.09 385.02 0.50 382.93 0.50 379.49 Q 0.50 259.79 0.50 128.77 C 0.50 127.21 1.85 125.96 3.27 125.13 Q 68.02 87.24 145.61 41.87 C 146.90 41.11 148.92 41.81 150.33 42.63 Q 219.34 82.64 289.83 124.16 C 291.25 125.00 292.80 126.11 294.76 127.15 Q 299.89 129.89 301.84 131.37 C 305.49 134.15 301.99 140.40 297.26 138.18 Q 295.67 137.42 294.41 136.58 A 0.26 0.26 0.0 0 0 294.00 136.80 L 294.00 209.83 A 0.44 0.44 0.0 0 0 294.36 210.26 Q 340.50 219.23 361.26 223.22 C 366.12 224.15 365.53 227.44 365.51 232.03 Q 365.50 234.52 365.49 251.11 A 0.73 0.73 0.0 0 0 366.22 251.84 L 370.02 251.84 A 3.64 3.64 0.0 0 1 373.66 255.48 L 373.66 256.72 A 3.45 3.44 0.0 0 1 370.21 260.16 L 366.15 260.16 A 0.65 0.65 0.0 0 0 365.50 260.81 L 365.50 333.29 Z M 9.05 131.40 A 0.30 0.30 0.0 0 0 8.90 131.66 L 8.90 380.18 A 0.30 0.30 0.0 0 0 9.05 380.44 L 142.74 458.43 A 0.30 0.30 0.0 0 0 143.19 458.17 L 143.19 53.67 A 0.30 0.30 0.0 0 0 142.74 53.41 L 9.05 131.40 Z M 285.68 380.52 A 0.32 0.32 0.0 0 0 285.84 380.25 L 285.84 131.66 A 0.32 0.32 0.0 0 0 285.68 131.39 L 151.98 53.39 A 0.32 0.32 0.0 0 0 151.50 53.67 L 151.50 458.24 A 0.32 0.32 0.0 0 0 151.98 458.52 L 285.68 380.52 Z M 294.62 218.77 A 0.36 0.36 0.0 0 0 294.19 219.13 L 294.19 374.90 A 0.36 0.36 0.0 0 0 294.73 375.21 L 357.13 338.81 A 0.36 0.36 0.0 0 0 357.31 338.50 L 357.31 231.30 A 0.36 0.36 0.0 0 0 357.02 230.94 L 294.62 218.77 Z"/>
                  <path fill="#000000" d="M 331.8028 153.6467 A 4.00 4.00 0.0 0 1 326.3286 155.0726 L 318.9110 150.7207 A 4.00 4.00 0.0 0 1 317.4851 145.2465 L 317.6572 144.9533 A 4.00 4.00 0.0 0 1 323.1314 143.5274 L 330.5490 147.8793 A 4.00 4.00 0.0 0 1 331.9749 153.3535 L 331.8028 153.6467 Z"/>
                  <path fill="#000000" d="M 360.6890 170.5463 A 4.00 4.00 0.0 0 1 355.2099 171.9531 L 347.8247 167.5855 A 4.00 4.00 0.0 0 1 346.4179 162.1064 L 346.5910 161.8137 A 4.00 4.00 0.0 0 1 352.0701 160.4069 L 359.4553 164.7745 A 4.00 4.00 0.0 0 1 360.8621 170.2536 L 360.6890 170.5463 Z"/>
                  <path fill="#000000" d="M 389.5811 187.4643 A 3.99 3.99 0.0 0 1 384.1181 188.8771 L 376.8287 184.5833 A 3.99 3.99 0.0 0 1 375.4159 179.1204 L 375.6189 178.7757 A 3.99 3.99 0.0 0 1 381.0819 177.3629 L 388.3713 181.6567 A 3.99 3.99 0.0 0 1 389.7841 187.1196 L 389.5811 187.4643 Z"/>
                  <path fill="#000000" d="M 418.5914 204.3586 A 3.99 3.99 0.0 0 1 413.1235 205.7523 L 405.7288 201.3617 A 3.99 3.99 0.0 0 1 404.3350 195.8938 L 404.5086 195.6014 A 3.99 3.99 0.0 0 1 409.9765 194.2077 L 417.3712 198.5983 A 3.99 3.99 0.0 0 1 418.7650 204.0662 L 418.5914 204.3586 Z"/>
                  <path fill="#000000" d="M 447.6480 221.1624 A 3.99 3.99 0.0 0 1 442.2027 222.6419 L 434.7225 218.3579 A 3.99 3.99 0.0 0 1 433.2431 212.9126 L 433.4120 212.6176 A 3.99 3.99 0.0 0 1 438.8573 211.1381 L 446.3375 215.4221 A 3.99 3.99 0.0 0 1 447.8169 220.8674 L 447.6480 221.1624 Z"/>
                  <path fill="#000000" d="M 476.5002 238.1477 A 3.99 3.99 0.0 0 1 471.0372 239.5605 L 463.6099 235.1855 A 3.99 3.99 0.0 0 1 462.1971 229.7225 L 462.3798 229.4123 A 3.99 3.99 0.0 0 1 467.8428 227.9995 L 475.2701 232.3745 A 3.99 3.99 0.0 0 1 476.6829 237.8375 L 476.5002 238.1477 Z"/>
                  <path fill="#000000" d="M 407.4604 256.3255 A 3.98 3.98 0.0 0 1 403.4873 260.3125 L 394.8874 260.3275 A 3.98 3.98 0.0 0 1 390.9004 256.3545 L 390.8996 255.8945 A 3.98 3.98 0.0 0 1 394.8727 251.9075 L 403.4726 251.8925 A 3.98 3.98 0.0 0 1 407.4596 255.8655 L 407.4604 256.3255 Z"/>
                  <path fill="#000000" d="M 440.9596 256.3545 A 3.98 3.98 0.0 0 1 436.9726 260.3275 L 428.3727 260.3125 A 3.98 3.98 0.0 0 1 424.3996 256.3255 L 424.4004 255.8655 A 3.98 3.98 0.0 0 1 428.3874 251.8925 L 436.9873 251.9075 A 3.98 3.98 0.0 0 1 440.9604 255.8945 L 440.9596 256.3545 Z"/>
                  <path fill="#000000" d="M 474.4604 256.3255 A 3.98 3.98 0.0 0 1 470.4873 260.3125 L 461.8874 260.3275 A 3.98 3.98 0.0 0 1 457.9004 256.3545 L 457.8996 255.8945 A 3.98 3.98 0.0 0 1 461.8727 251.9075 L 470.4726 251.8925 A 3.98 3.98 0.0 0 1 474.4596 255.8655 L 474.4604 256.3255 Z"/>
                </svg>
              </button>
            </div>
            
            <!-- Секущие плоскости -->
            <div class="join">
              <button class="btn btn-sm join-item" id="ifcClipX" style="margin-right:2px"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" class="MuiSvgIcon-root MuiSvgIcon-fontSizeLarge" focusable="false" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 3v9.07l3.87-1.72a2 2 0 01.81-.17 2.08 2.08 0 011.77 3.09 1.09 1.09 0 01-.56.56l-4.36 1.94L21.6 21V9z"></path><path d="M4.74 15.33l9.14-4.07a1 1 0 011.32.51 1 1 0 01-.51 1.32l-9.14 4.07 4 1.52L9 20l-6.6-2.53 2.53-6.6 1.32.51z"></path></svg></button>
              <button class="btn btn-sm join-item" id="ifcClipZ" style="margin-right:2px"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" class="MuiSvgIcon-root MuiSvgIcon-fontSizeLarge" focusable="false" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13.82a1.09 1.09 0 01-.56-.56 2.08 2.08 0 011.78-3.09 2 2 0 01.81.17l3.87 1.72V3l-11 6v12l9.54-5.2z"></path><path d="M17.24 11.37l1.32-.51 2.53 6.6L14.5 20l-.5-1.32 4-1.52-9.18-4.07a1 1 0 01-.51-1.32 1 1 0 011.32-.51l9.14 4.07z"></path></svg></button>
              <button class="btn btn-sm join-item" id="ifcClipY" style="margin-right:0px"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" class="MuiSvgIcon-root MuiSvgIcon-fontSizeLarge" focusable="false" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.25 11.18v3.52A1.87 1.87 0 0111 15.88a1 1 0 01-.32-.72V11.1l-9 4.5L12.45 21l9.9-5.4z"></path><path d="M8.85 8.4L8 7.5 12.45 3 17 7.5l-.9.9-2.7-2.7v9a.9.9 0 01-.9.9.9.9 0 01-.9-.9v-9z"></path></svg></button>
            </div>
                                 
          </div>
        </div>              

        <!-- Основной контейнер просмотрщика -->
        <div id="ifcViewerMain" class="w-full flex-1 relative"></div>

        <!-- Боковая панель (временно скрыта) -->
        <div id="ifcSidebar" class="absolute left-0 top-0 h-full w-80 bg-base-200 shadow-lg transform -translate-x-full transition-transform duration-300 pointer-events-none z-40" style="display: none;">
          <div class="flex flex-col h-full">
            <!-- Заголовок панели -->
            <div class="flex items-center justify-between p-4 border-b border-base-300">
              <h3 class="font-medium">Структура модели</h3>
              <button id="ifcSidebarClose" class="btn btn-ghost btn-sm">✕</button>
            </div>
            
            <!-- Информация о модели -->
            <div id="ifcInfo" class="p-4 border-b border-base-300 bg-base-100">
              <div class="text-sm opacity-70">Модель не загружена</div>
            </div>
            
            <!-- Дерево структуры -->
            <div class="flex-1 overflow-auto">
              <div id="ifcTree" class="p-2"></div>
            </div>
            
            <!-- Переключатель режима изоляции -->
            <div class="p-4 border-t border-base-300">
              <label class="label cursor-pointer">
                <span class="label-text">Режим изоляции</span>
                <input type="checkbox" id="ifcIsolateToggle" class="toggle toggle-primary" />
              </label>
            </div>
          </div>
        </div>

        <!-- Кнопка сайдбара (временно скрыта) -->
        <div id="ifcSidebarToggleContainer" class="absolute top-4 left-4 z-30" style="display: none;">
          <button id="ifcSidebarToggle" class="btn btn-primary btn-sm">☰</button>
        </div>
       

        <!-- Панель зума (будет создана Viewer'ом) -->
        <div id="ifcZoomPanel" class="absolute bottom-4 right-4 z-30"></div>
      </div>
    `;

    this.containerElement.innerHTML = html;

    // Сохраняем ссылки на элементы
    this.elements.viewerContainer = this.containerElement.querySelector('#ifcViewerMain');
    this.elements.sidebar = this.containerElement.querySelector('#ifcSidebar');
    this.elements.controls = this.containerElement.querySelector('#ifcControls');
    this.elements.uploadInput = this.containerElement.querySelector('#ifcFileInput');
  }

  /**
   * Применяет тему интерфейса
   * @private
   */
  _applyTheme() {
    const container = this.containerElement.querySelector('.ifc-viewer-container');
    if (container) {
      container.setAttribute('data-theme', this.options.theme);
    }
  }

  /**
   * Инициализирует компонент Viewer
   * @private
   */
  _initViewer() {
    if (!this.elements.viewerContainer) {
      throw new Error('Контейнер для viewer не найден');
    }

    this.viewer = new Viewer(this.elements.viewerContainer);
    this.viewer.init();
  }

  /**
   * Инициализирует сервис IFC
   * @private
   */
  _initIfcService() {
    if (!this.viewer) {
      throw new Error('Viewer должен быть инициализирован перед IfcService');
    }

    this.ifcService = new IfcService(this.viewer, this.options.wasmUrl);
    this.ifcService.init();
  }

  /**
   * Инициализирует компонент дерева IFC
   * @private
   */
  _initTreeView() {
    const treeElement = this.containerElement.querySelector('#ifcTree');
    if (treeElement) {
      this.ifcTreeView = new IfcTreeView(treeElement);
      
      // Настраиваем обработчик выбора узла
      this.ifcTreeView.onSelect(async (node) => {
        if (this.ifcService) {
          const ids = this.ifcService.collectElementIDsFromStructure(node);
          await this.ifcService.highlightByIds(ids);
        }
      });
    }
  }

  /**
   * Настраивает обработчики событий
   * @private
   */
  _setupEventHandlers() {
    // Кнопка переключения сайдбара
    this._addEventListener('#ifcSidebarToggle', 'click', () => {
      this._setSidebarVisible(true);
    });

    // Кнопка закрытия сайдбара  
    this._addEventListener('#ifcSidebarClose', 'click', () => {
      this._setSidebarVisible(false);
    });

    // Загрузка файла
    this._addEventListener('#ifcUploadBtn', 'click', () => {
      this.elements.uploadInput?.click();
    });

    this._addEventListener('#ifcFileInput', 'change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await this.loadModel(file);
        e.target.value = ''; // Очистка input
      }
    });

    // Переключатель изоляции
    this._addEventListener('#ifcIsolateToggle', 'change', (e) => {
      if (this.ifcService) {
        this.ifcService.setIsolateMode(e.target.checked);
      }
    });

    // ==================== ОБРАБОТЧИКИ ВЕРХНЕЙ ПАНЕЛИ ====================

    // Кнопки качества рендеринга
    this._addEventListener('#ifcQualLow', 'click', () => {
      this._setQuality('low');
    });
    this._addEventListener('#ifcQualMed', 'click', () => {
      this._setQuality('medium');
    });
    this._addEventListener('#ifcQualHigh', 'click', () => {
      this._setQuality('high');
    });

    // Переключатели отображения  
    this._addEventListener('#ifcToggleEdges', 'click', () => {
      this._toggleEdges();
    });
    this._addEventListener('#ifcToggleShadows', 'click', () => {
      this._toggleShadows();
    });
    this._addEventListener('#ifcToggleProjection', 'click', () => {
      this._toggleProjection();
    });
    this._addEventListener('#ifcToggleShading', 'click', () => {
      this._toggleShading();
    });

    // Секущие плоскости
    this._addEventListener('#ifcClipX', 'click', () => {
      this._toggleClipAxis('x');
    });
    this._addEventListener('#ifcClipY', 'click', () => {
      this._toggleClipAxis('y');
    });
    this._addEventListener('#ifcClipZ', 'click', () => {
      this._toggleClipAxis('z');
    });

    // Слайдеры позиции секущих плоскостей
    this._addEventListener('#ifcClipXRange', 'input', (e) => {
      if (this.viewer && this.viewerState.clipping.x) {
        const t = parseFloat(e.target.value);
        this.viewer.setSectionNormalized('x', true, t);
      }
    });
    this._addEventListener('#ifcClipYRange', 'input', (e) => {
      if (this.viewer && this.viewerState.clipping.y) {
        const t = parseFloat(e.target.value);
        this.viewer.setSectionNormalized('y', true, t);
      }
    });
    this._addEventListener('#ifcClipZRange', 'input', (e) => {
      if (this.viewer && this.viewerState.clipping.z) {
        const t = parseFloat(e.target.value);
        this.viewer.setSectionNormalized('z', true, t);
      }
    });

    // Дополнительная кнопка загрузки в верхней панели
    this._addEventListener('#ifcUploadBtnTop', 'click', () => {
      this.elements.uploadInput?.click();
    });
  }

  /**
   * Обновляет дерево структуры модели
   * @param {Object} model - Загруженная модель
   * @private
   */
  async _updateTreeView(model) {
    if (!this.ifcTreeView || !this.ifcService || !model) return;

    try {
      const structure = await this.ifcService.getSpatialStructure(model.modelID);
      if (structure) {
        this.ifcTreeView.render(structure);
      }
    } catch (error) {
      console.error('Ошибка обновления дерева структуры:', error);
    }
  }

  /**
   * Обновляет информационную панель
   * @private
   */
  _updateInfoPanel() {
    const infoElement = this.containerElement.querySelector('#ifcInfo');
    if (!infoElement || !this.ifcService) return;

    const info = this.ifcService.getLastInfo();
    infoElement.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium text-xs">${info.name || '—'}</div>
          <div class="opacity-70">modelID: ${info.modelID || '—'}</div>
        </div>
      </div>
    `;
  }

  /**
   * Показывает/скрывает боковую панель
   * @param {boolean} visible - Видимость панели
   * @private
   */
  _setSidebarVisible(visible) {
    const sidebar = this.containerElement.querySelector('#ifcSidebar');
    if (!sidebar) return;

    if (visible) {
      sidebar.classList.remove('-translate-x-full');
      sidebar.classList.add('translate-x-0');
      sidebar.classList.remove('pointer-events-none');
    } else {
      sidebar.classList.add('-translate-x-full');
      sidebar.classList.remove('translate-x-0');
      sidebar.classList.add('pointer-events-none');
    }
  }

  /**
   * Показывает прелоадер
   * @private
   */
  _showPreloader() {
    const preloader = this.containerElement.querySelector('#ifcPreloader');
    if (preloader) {
      preloader.style.opacity = '1';
      preloader.style.visibility = 'visible';
    }
  }

  /**
   * Скрывает прелоадер
   * @private
   */
  _hidePreloader() {
    const preloader = this.containerElement.querySelector('#ifcPreloader');
    if (preloader) {
      preloader.style.transition = 'opacity 400ms ease';
      preloader.style.opacity = '0';
      setTimeout(() => {
        preloader.style.visibility = 'hidden';
      }, 400);
    }
  }

  /**
   * Добавляет слушатель события с автоматической очисткой
   * @param {string} selector - Селектор элемента
   * @param {string} event - Тип события
   * @param {Function} handler - Обработчик события
   * @private
   */
  _addEventListener(selector, event, handler) {
    const element = this.containerElement.querySelector(selector);
    if (element) {
      element.addEventListener(event, handler);
      this.eventListeners.set(`${selector}.${event}`, handler);
    }
  }

  /**
   * Отправляет пользовательское событие
   * @param {string} eventName - Имя события  
   * @param {Object} detail - Детали события
   * @private
   */
  _dispatchEvent(eventName, detail = {}) {
    try {
      const event = new CustomEvent(`ifcviewer:${eventName}`, {
        detail,
        bubbles: true
      });
      this.containerElement.dispatchEvent(event);
    } catch (error) {
      console.error('Ошибка отправки события:', error);
    }
  }

  // ==================== МЕТОДЫ УПРАВЛЕНИЯ ВЕРХНЕЙ ПАНЕЛИ ====================

  /**
   * Устанавливает качество рендеринга
   * @param {string} preset - Качество ('low' | 'medium' | 'high')
   * @private
   */
  _setQuality(preset) {
    if (!this.viewer) return;

    this.viewerState.quality = preset;
    this.viewer.setQuality(preset);

    // Обновляем активное состояние кнопок
    const buttons = ['#ifcQualLow', '#ifcQualMed', '#ifcQualHigh'];
    const activeButton = preset === 'low' ? '#ifcQualLow' : 
                        preset === 'high' ? '#ifcQualHigh' : '#ifcQualMed';

    buttons.forEach(selector => {
      const btn = this.containerElement.querySelector(selector);
      if (btn) {
        btn.classList.toggle('btn-active', selector === activeButton);
      }
    });
  }

  /**
   * Переключает отображение граней
   * @private
   */
  _toggleEdges() {
    if (!this.viewer) return;

    this.viewerState.edgesVisible = !this.viewerState.edgesVisible;
    this.viewer.setEdgesVisible(this.viewerState.edgesVisible);

    // Обновляем состояние кнопки
    const btn = this.containerElement.querySelector('#ifcToggleEdges');
    if (btn) {
      btn.classList.toggle('btn-active', this.viewerState.edgesVisible);
    }
  }

  /**
   * Переключает тени (вкл/выкл) для сцены.
   * @private
   */
  _toggleShadows() {
    if (!this.viewer) return;
    this.viewerState.shadowsEnabled = !this.viewerState.shadowsEnabled;
    try { this.viewer.setShadowsEnabled(this.viewerState.shadowsEnabled); } catch (_) {}
    const btn = this.containerElement.querySelector('#ifcToggleShadows');
    if (btn) btn.classList.toggle('btn-active', this.viewerState.shadowsEnabled);
  }

  /**
   * Переключает режим проекции (Perspective ↔ Ortho) и меняет иконку по правилу "показываем действие".
   * @private
   */
  _toggleProjection() {
    if (!this.viewer) return;

    // Иконки: показываем альтернативный режим
    const ICON_PERSPECTIVE = `
      <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <path fill="#000000" d="M365.50 333.29 A 0.30 0.30 0.0 0 0 365.95 333.55 L 492.36 259.80 A 0.47 0.47 0.0 0 0 492.51 259.12 Q 489.74 255.31 492.90 252.78 A 0.30 0.30 0.0 0 0 492.83 252.27 C 489.14 250.57 490.13 245.43 493.90 244.50 C 496.33 243.90 501.93 247.88 504.97 249.79 A 1.50 1.48 -85.3 0 1 505.54 250.47 L 505.97 251.53 A 0.72 0.71 76.6 0 0 506.67 251.97 C 509.70 251.84 512.28 254.84 511.15 257.67 Q 510.77 258.62 508.18 260.14 C 355.38 349.68 251.70 410.06 149.28 469.74 A 3.94 3.93 -44.9 0 1 145.31 469.74 Q 7.70 389.45 2.96 386.69 C 0.09 385.02 0.50 382.93 0.50 379.49 Q 0.50 259.79 0.50 128.77 C 0.50 127.21 1.85 125.96 3.27 125.13 Q 68.02 87.24 145.61 41.87 C 146.90 41.11 148.92 41.81 150.33 42.63 Q 219.34 82.64 289.83 124.16 C 291.25 125.00 292.80 126.11 294.76 127.15 Q 299.89 129.89 301.84 131.37 C 305.49 134.15 301.99 140.40 297.26 138.18 Q 295.67 137.42 294.41 136.58 A 0.26 0.26 0.0 0 0 294.00 136.80 L 294.00 209.83 A 0.44 0.44 0.0 0 0 294.36 210.26 Q 340.50 219.23 361.26 223.22 C 366.12 224.15 365.53 227.44 365.51 232.03 Q 365.50 234.52 365.49 251.11 A 0.73 0.73 0.0 0 0 366.22 251.84 L 370.02 251.84 A 3.64 3.64 0.0 0 1 373.66 255.48 L 373.66 256.72 A 3.45 3.44 0.0 0 1 370.21 260.16 L 366.15 260.16 A 0.65 0.65 0.0 0 0 365.50 260.81 L 365.50 333.29 Z"/>
      </svg>
    `;
    const ICON_ORTHO = `
      <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <path fill="#000000" d="M256.02 48.55 Q 257.33 48.55 258.06 48.94 Q 381.49 115.11 442.91 148.14 Q 445.24 149.39 445.26 152.25 Q 445.52 184.71 445.52 256.00 Q 445.52 327.29 445.26 359.75 Q 445.24 362.61 442.91 363.86 Q 381.49 396.89 258.06 463.06 Q 257.33 463.45 256.02 463.45 Q 254.71 463.45 253.98 463.06 Q 130.55 396.89 69.13 363.86 Q 66.80 362.61 66.78 359.75 Q 66.52 327.29 66.52 256.00 Q 66.52 184.71 66.78 152.25 Q 66.80 149.39 69.13 148.14 Q 130.55 115.11 253.98 48.94 Q 254.71 48.55 256.02 48.55 Z"/>
      </svg>
    `;

    const next = this.viewer.toggleProjection?.();
    const mode = next || this.viewer.getProjectionMode?.() || 'perspective';
    const btn = this.containerElement.querySelector('#ifcToggleProjection');
    if (btn) {
      btn.innerHTML = (mode === 'perspective') ? ICON_ORTHO : ICON_PERSPECTIVE;
    }
  }

  /**
   * Переключает плоское затенение
   * @private
   */
  _toggleShading() {
    if (!this.viewer) return;

    this.viewerState.flatShading = !this.viewerState.flatShading;
    this.viewer.setFlatShading(this.viewerState.flatShading);

    // Обновляем состояние кнопки
    const btn = this.containerElement.querySelector('#ifcToggleShading');
    if (btn) {
      btn.classList.toggle('btn-active', this.viewerState.flatShading);
    }
  }

  /**
   * Переключает секущую плоскость по оси
   * @param {string} axis - Ось ('x' | 'y' | 'z')
   * @private
   */
  _toggleClipAxis(axis) {
    if (!this.viewer) return;

    const clipping = this.viewerState.clipping;
    const currentState = clipping[axis];
    const newState = !currentState;

    // Если включаем новую ось, отключаем предыдущую активную
    if (newState && clipping.active && clipping.active !== axis) {
      const prevAxis = clipping.active;
      clipping[prevAxis] = false;
      this.viewer.setSection(prevAxis, false, 0);
      
      // Обновляем кнопку предыдущей оси
      const prevBtn = this.containerElement.querySelector(`#ifcClip${prevAxis.toUpperCase()}`);
      if (prevBtn) prevBtn.classList.remove('btn-active');
      
      // Скрываем слайдер предыдущей оси
      const prevControl = this.containerElement.querySelector(`#ifcClip${prevAxis.toUpperCase()}Control`);
      if (prevControl) prevControl.style.display = 'none';
    }

    // Устанавливаем новое состояние
    clipping[axis] = newState;
    clipping.active = newState ? axis : null;
    this.viewer.setSection(axis, newState, 0);

    // Обновляем состояние кнопки
    const btn = this.containerElement.querySelector(`#ifcClip${axis.toUpperCase()}`);
    if (btn) {
      btn.classList.toggle('btn-active', newState);
    }

    // Показываем/скрываем панель слайдеров
    this._updateClipControls();

    // Показываем/скрываем слайдер текущей оси
    const control = this.containerElement.querySelector(`#ifcClip${axis.toUpperCase()}Control`);
    if (control) {
      control.style.display = newState ? 'flex' : 'none';
    }
  }

  /**
   * Обновляет видимость панели управления секущими плоскостями
   * @private
   */
  _updateClipControls() {
    const panel = this.containerElement.querySelector('#ifcClipControls');
    if (!panel) return;

    const hasActiveClipping = this.viewerState.clipping.active !== null;
    panel.style.display = hasActiveClipping ? 'block' : 'none';
  }
}
