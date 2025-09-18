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

export class IfcViewer {
  /**
   * Создаёт новый экземпляр IfcViewer
   * @param {Object} options - Параметры конфигурации
   * @param {HTMLElement|string} options.container - Контейнер для рендера (элемент или селектор)
   * @param {string} [options.ifcUrl] - URL для загрузки IFC файла
   * @param {File} [options.ifcFile] - File объект для загрузки IFC файла
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
      edgesVisible: true,
      flatShading: true,
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
      <div class="ifc-viewer-container" style="width: 100%; height: 100%; position: relative; display: flex; flex-direction: column;">
        <!-- Верхняя панель управления -->
        <div id="ifcToolbar" class="navbar bg-neutral text-neutral-content shrink-0 px-4" style="${this.options.showToolbar ? '' : 'display: none;'}">
          <div class="navbar-start">
            <span class="text-lg font-semibold">IFC Viewer</span>
          </div>
          <div class="navbar-end flex gap-2">
            <!-- Качество рендеринга -->
            <div class="join">
              <button class="btn btn-sm join-item" id="ifcQualLow">Low</button>
              <button class="btn btn-sm join-item btn-active" id="ifcQualMed">Med</button>
              <button class="btn btn-sm join-item" id="ifcQualHigh">High</button>
            </div>
            
            <!-- Стили отображения -->
            <div class="join">
              <button class="btn btn-sm join-item btn-active" id="ifcToggleEdges">Edges</button>
              <button class="btn btn-sm join-item btn-active" id="ifcToggleShading">Flat</button>
            </div>
            
            <!-- Секущие плоскости -->
            <div class="join">
              <button class="btn btn-sm join-item" id="ifcClipX">Clip X</button>
              <button class="btn btn-sm join-item" id="ifcClipY">Clip Y</button>
              <button class="btn btn-sm join-item" id="ifcClipZ">Clip Z</button>
            </div>
            
            <!-- Кнопка загрузки файла -->
            <button id="ifcUploadBtnTop" class="btn btn-sm bg-white text-black">📁 Загрузить</button>
          </div>
        </div>

        <!-- Слайдеры секущих плоскостей (изначально скрыты) -->
        <div id="ifcClipControls" class="bg-base-200 px-4 py-2 border-b border-base-300" style="display: ${this.options.showToolbar ? 'none' : 'none'};">
          <div class="flex items-center gap-4 text-sm">
            <!-- Слайдер X -->
            <div id="ifcClipXControl" class="flex items-center gap-2" style="display: none;">
              <span class="w-12">Clip X:</span>
              <input type="range" id="ifcClipXRange" class="range range-sm flex-1" min="0" max="1" step="0.01" value="0.5">
            </div>
            <!-- Слайдер Y -->
            <div id="ifcClipYControl" class="flex items-center gap-2" style="display: none;">
              <span class="w-12">Clip Y:</span>
              <input type="range" id="ifcClipYRange" class="range range-sm flex-1" min="0" max="1" step="0.01" value="0.5">
            </div>
            <!-- Слайдер Z -->
            <div id="ifcClipZControl" class="flex items-center gap-2" style="display: none;">
              <span class="w-12">Clip Z:</span>
              <input type="range" id="ifcClipZRange" class="range range-sm flex-1" min="0" max="1" step="0.01" value="0.5">
            </div>
          </div>
        </div>

        <!-- Прелоадер -->
        <div id="ifcPreloader" class="absolute inset-0 bg-base-100 flex items-center justify-center z-50">
          <div class="text-center">
            <span class="loading loading-spinner loading-lg"></span>
            <div class="mt-2 text-sm opacity-70">Загрузка модели...</div>
          </div>
        </div>

        <!-- Основной контейнер просмотрщика -->
        <div id="ifcViewerMain" class="w-full flex-1 relative"></div>

        <!-- Боковая панель -->
        <div id="ifcSidebar" class="absolute left-0 top-0 h-full w-80 bg-base-200 shadow-lg transform -translate-x-full transition-transform duration-300 pointer-events-none z-40">
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

        <!-- Панель управления -->
        <div id="ifcControls" class="absolute top-4 left-4 z-30" style="${this.options.showControls ? '' : 'display: none;'}">
          <!-- Кнопка панели (показываем если включен сайдбар) -->
          <button id="ifcSidebarToggle" class="btn btn-primary btn-sm mb-2">☰</button>
          
          <!-- Кнопка загрузки -->
          <button id="ifcUploadBtn" class="btn btn-secondary btn-sm">📁</button>
          <input type="file" id="ifcFileInput" accept=".ifc,.ifczip,.zip" style="display: none;">
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

    this.ifcService = new IfcService(this.viewer);
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
    if (!this.elements.sidebar) return;

    if (visible) {
      this.elements.sidebar.classList.remove('-translate-x-full');
      this.elements.sidebar.classList.add('translate-x-0');
      this.elements.sidebar.classList.remove('pointer-events-none');
    } else {
      this.elements.sidebar.classList.add('-translate-x-full');
      this.elements.sidebar.classList.remove('translate-x-0');
      this.elements.sidebar.classList.add('pointer-events-none');
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
