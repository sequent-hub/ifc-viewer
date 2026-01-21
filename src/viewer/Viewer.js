// Класс Viewer инкапсулирует настройку three.js сцены
// Чистый JS, без фреймворков. Комментарии на русском.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { HueSaturationShader } from "three/examples/jsm/shaders/HueSaturationShader.js";
import { BrightnessContrastShader } from "three/examples/jsm/shaders/BrightnessContrastShader.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { NavCube } from "./NavCube.js";
import { SectionManipulator } from "./SectionManipulator.js";
import { SectionCapsRenderer } from "./SectionCapsRenderer.js";
import { SectionCapsPass } from "./SectionCapsPass.js";
import { ZoomToCursorController } from "./ZoomToCursorController.js";
import { MiddleMousePanController } from "./MiddleMousePanController.js";
import { RightMouseModelMoveController } from "./RightMouseModelMoveController.js";

export class Viewer {
  constructor(containerElement) {
    /** @type {HTMLElement} */
    this.container = containerElement;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    // Переключение проекции (добавляем второй "вид без перспективы", не трогая свет/материалы/постпроцесс)
    this._projection = {
      mode: 'perspective', // 'perspective' | 'ortho'
      /** @type {THREE.PerspectiveCamera|null} */
      persp: null,
      /** @type {THREE.OrthographicCamera|null} */
      ortho: null,
      // Половина высоты орто-фрустума (top=+h,bottom=-h). Подбираем из текущего perspective-вида.
      orthoHalfHeight: 10,
      // Пределы зума для Ortho
      minZoom: 0.25,
      maxZoom: 8,
    };
    this.animationId = null;
    this.controls = null;
    this.zoomListeners = new Set();
    this.lastZoomPercent = null;
    this.resizeObserver = null;
    this.demoCube = null;
    this.activeModel = null;
    this.autoRotateDemo = true;
    this.edgesVisible = false;
    this.flatShading = true;
    this.quality = 'medium'; // low | medium | high
    this.navCube = null;
    this.sectionOverlayScene = null;
    // Плоскость под моделью (приёмник теней). Ничего не "включает" само по себе:
    // если тени в рендерере отключены — плоскость останется невидимой.
    this.shadowReceiver = null;
    // Управление тенями через публичный API
    this.shadowsEnabled = true;
    /** @type {THREE.DirectionalLight|null} */
    this.sunLight = null;
    /** @type {THREE.AmbientLight|null} */
    this.ambientLight = null;
    /** @type {THREE.HemisphereLight|null} */
    this.hemiLight = null;
    // Базовые координаты солнца (чтобы менять только высоту по Y)
    this._sunBaseXZ = { x: 5, z: 5 };
    // Параметры градиента тени на земле (модифицирует только ShadowMaterial приёмника)
    this.shadowGradient = {
      enabled: true,
      // Длина градиента (в мировых единицах, от контура bbox здания наружу)
      length: 14.4,
      // 0..1 — насколько тень "растворяется" на дальнем краю
      strength: 1.0,
      // Кривая затухания (нелинейность). 1 = линейно, >1 = дольше темно у здания, быстрее растворение в конце.
      curve: 0.5,
      // bbox здания в XZ (центр и halfSize)
      buildingCenterXZ: new THREE.Vector2(0, 0),
      buildingHalfSizeXZ: new THREE.Vector2(0.5, 0.5),
      // ссылка на скомпилированный шейдер ShadowMaterial (для обновления uniforms)
      _shader: null,
    };
    // Настройки вида тени
    this.shadowStyle = {
      opacity: 0.14,  // прозрачность тени на земле (ShadowMaterial.opacity)
      softness: 0.0,  // мягкость края (DirectionalLight.shadow.radius)
    };
    // Базовый цвет тени на земле (по умолчанию нейтрально-серый, чтобы можно было сравнивать с "синей" тенью в Шаге 2)
    this._shadowReceiverBaseColor = new THREE.Color(0x2a2a2a);

    // Материалы (пресеты)
    this.materialStyle = {
      preset: 'original', // original | matte | glossy | plastic | concrete
      roughness: null,    // override (0..1) или null = использовать пресет
      metalness: null,    // override (0..1) или null = использовать пресет
    };
    /** @type {WeakMap<THREE.Mesh, any>} */
    this._meshOriginalMaterial = new WeakMap();
    /** @type {WeakMap<any, any>} */
    this._origToConvertedMaterial = new WeakMap();

    // Визуал: диагностика (по умолчанию ВСЁ выключено, чтобы не менять стартовую картинку)
    this.visual = {
      environment: { enabled: false, intensity: 1.0 },
      tone: { enabled: false, exposure: 1.0 },
      ao: { enabled: false, intensity: 0.75, radius: 12, minDistance: 0.001, maxDistance: 0.2 },
      color: { enabled: false, hue: 0.0, saturation: 0.0, brightness: 0.0, contrast: 0.0 },
    };
    // Пресет Realtime-quality: хранит снимок пользовательских настроек для восстановления
    this._rtQuality = { enabled: false, snapshot: null };
    // Пресет "Тест": полностью изолированная настройка (тени+самозатенение+визуал из рекомендаций)
    this._testPreset = { enabled: false, snapshot: null };

    // Шаг 2: холодное освещение (отдельно от пресета "Тест", но обычно используется вместе с ним)
    this._coolLighting = { enabled: false, snapshot: null, params: { hueDeg: 210, amount: 1.0 } };

    // Шаг 3: фон сцены (как в Autodesk)
    this._step3Background = { enabled: false, snapshot: null, colorHex: 0xe8eef4 };
    this._baselineRenderer = null;
    this._pmrem = null;
    this._roomEnvTex = null;
    this._composer = null;
    this._renderPass = null;
    this._ssaoPass = null;
    this._hueSatPass = null;
    this._bcPass = null;
    // Шаг 4: финальная постобработка (контраст/насыщенность) — должна быть последним pass'ом
    this._step4Pass = null;
    this._step4 = { enabled: false, saturation: 1.0, contrast: 1.0 };
    // Сечение: заливка "внутренностей" (cap) через stencil buffer
    this._sectionCaps = new SectionCapsRenderer({ color: 0x212121 });
    this._sectionCapsPass = null;
    this.clipping = {
      enabled: false,
      planes: [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), Infinity),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), Infinity),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), Infinity),
      ],
      gizmos: {
        x: null,
        y: null,
        z: null,
      },
      manipulators: {
        x: null,
        y: null,
        z: null,
      },
    };
    // Состояние "есть ли активное сечение" (нужно, чтобы сечение влияло на тени/освещение).
    this._sectionClippingActive = false;
    /** @type {WeakMap<THREE.Mesh, any>} */
    this._sectionOriginalMaterial = new WeakMap();
    // Локальная подсветка "внутри": без теней, с малой дальностью (чтобы не пересвечивать фасад/внешнюю тень)
    this._interiorAssist = { light: null, box: null, enabled: false, lastBoxAt: 0 };
    // Пост-эффекты только "внутри": AO OFF (убирает "сетку"), чуть контраста (без глобального пересвета)
    this._interiorPost = { snapshot: null, contrast: 0.12 };

    // Snapshot начального состояния для Home
    this._home = {
      cameraPos: null,
      target: new THREE.Vector3(0, 0, 0),
      // FOV для перспективы (часть "масштаба" кадра)
      perspFov: null,
      edgesVisible: false,
      flatShading: true,
      quality: 'medium',
      clipEnabled: [Infinity, Infinity, Infinity],
      // Трансформ модели (для сброса ПКМ-сдвигов)
      modelTransform: null, // { position: Vector3, quaternion: Quaternion, scale: Vector3 }
      // Положение "земли/тени" (чтобы Home возвращал тень вместе с моделью)
      shadowReceiverPos: null, // THREE.Vector3|null
      sunTargetPos: null,      // THREE.Vector3|null
      shadowGradCenterXZ: null // THREE.Vector2|null
    };

    // Визуализация оси вращения
    this.rotationAxisLine = null;
    this._isLmbDown = false;
    // OrbitControls 'start' может прийти раньше нашего bubble pointerdown.
    // Поэтому сохраняем кнопку последнего pointerdown в capture-phase.
    this._lastPointerDownButton = null;
    this._wasRotating = false;
    this._prevViewDir = null;
    this._smoothedAxis = null;
    this._recentPointerDelta = 0;
    this._pointerPxThreshold = 2; // минимальный экранный сдвиг
    this._rotAngleEps = 0.01;     // ~0.57° минимальный угловой сдвиг
    this._axisEmaAlpha = 0.15;    // коэффициент сглаживания оси

    this._damping = {
      dynamic: true,
      base: 0.06,
      settle: 0.18,
      settleMs: 250,
      isSettling: false,
      lastEndTs: 0,
    };

    this._onPointerDown = null;
    this._onPointerUp = null;
    this._onPointerMove = null;
    this._onControlsStart = null;
    this._onControlsChange = null;
    this._onControlsEnd = null;

    // Zoom-to-cursor (wheel): включено по умолчанию, debug выключен
    this._zoomToCursor = {
      enabled: true,
      debug: false,
      controller: null,
    };

    // MMB-pan (wheel-click drag): включено по умолчанию, debug выключен
    this._mmbPan = {
      enabled: true,
      debug: false,
      controller: null,
    };

    // RMB: перемещение модели относительно "оси" (pivot), pivot остаётся на месте
    this._rmbModelMove = {
      enabled: false,
      debug: false,
      controller: null,
      pivotAnchor: null, // THREE.Vector3|null (фиксированная ось после ПКМ)
    };

    this.handleResize = this.handleResize.bind(this);
    this.animate = this.animate.bind(this);
  }

  /**
   * Включает/выключает zoom-to-cursor (wheel).
   * @param {boolean} enabled
   */
  setZoomToCursorEnabled(enabled) {
    if (!this._zoomToCursor) return;
    this._zoomToCursor.enabled = !!enabled;
  }

  /**
   * Включает/выключает диагностическое логирование zoom-to-cursor.
   * @param {boolean} debug
   */
  setZoomToCursorDebug(debug) {
    if (!this._zoomToCursor) return;
    this._zoomToCursor.debug = !!debug;
  }

  /**
   * Возвращает текущие флаги zoom-to-cursor (для диагностики).
   */
  getZoomToCursorState() {
    if (!this._zoomToCursor) return { enabled: false, debug: false };
    return { enabled: !!this._zoomToCursor.enabled, debug: !!this._zoomToCursor.debug };
  }

  /**
   * Возвращает "домашнюю" точку вращения для текущей модели:
   * центр bbox (совпадает с кадрированием при первичной загрузке).
   * @returns {THREE.Vector3|null}
   */
  #getDefaultPivotForActiveModel() {
    const subject = this.activeModel || this.demoCube;
    if (!subject) return null;
    try {
      const box = new THREE.Box3().setFromObject(subject);
      const center = box.getCenter(new THREE.Vector3());
      return center.clone();
    } catch (_) {
      return null;
    }
  }

  /**
   * Возвращает целевой pivot для ЛКМ-вращения:
   * - если модель двигали ПКМ, используем фиксированную ось (pivotAnchor)
   * - иначе используем "домашний" pivot (центр bbox)
   * @returns {THREE.Vector3|null}
   */
  #getDesiredPivotForRotate() {
    try {
      const fixed = this._rmbModelMove?.pivotAnchor;
      if (fixed) return fixed.clone();
    } catch (_) {}
    return this.#getDefaultPivotForActiveModel();
  }

  /**
   * После zoom-to-cursor target может сместиться к точке под курсором (например, к углу),
   * и вращение начнёт происходить вокруг этой точки.
   * Здесь мы возвращаем pivot к "домашнему" центру модели перед началом LMB-вращения,
   * сохраняя кадр (camera смещается на тот же delta).
   */
  #rebaseRotatePivotToModelCenterIfNeeded() {
    if (!this.camera || !this.controls) return;
    const desired = this.#getDesiredPivotForRotate();
    if (!desired) return;

    const current = this.controls.target;
    const dx = desired.x - current.x;
    const dy = desired.y - current.y;
    const dz = desired.z - current.z;
    const dist2 = dx * dx + dy * dy + dz * dz;
    // Порог: чтобы не дергать pivot от микросдвигов зума
    if (dist2 < 1e-6) return;

    // Важно: нельзя "двигать модель к оси" визуально. Поэтому:
    // 1) запоминаем положение старого target на экране
    // 2) меняем pivot (controls.target) на центр модели
    // 3) компенсируем экранный сдвиг через viewOffset (MMB-pan controller), чтобы картинка не дернулась
    const dom = this.renderer?.domElement;
    const rect = dom?.getBoundingClientRect?.();
    const w = rect?.width || 0;
    const h = rect?.height || 0;
    const canProject = w > 1 && h > 1;

    const oldTarget = this.controls.target.clone();
    let p0 = null;
    if (canProject) {
      try { this.camera.updateMatrixWorld?.(true); } catch (_) {}
      try { p0 = oldTarget.clone().project(this.camera); } catch (_) { p0 = null; }
    }

    try { this.controls.target.copy(desired); } catch (_) {}
    try { this.controls.update(); } catch (_) {}

    if (canProject && p0) {
      let p1 = null;
      try { this.camera.updateMatrixWorld?.(true); } catch (_) {}
      try { p1 = oldTarget.clone().project(this.camera); } catch (_) { p1 = null; }
      if (p1) {
        // NDC -> px. Y: NDC вверх, а viewOffset.y увеличением поднимает картинку (см. MMB-pan).
        const dNdcX = (p1.x - p0.x);
        const dNdcY = (p1.y - p0.y);
        const dxPx = dNdcX * (w / 2);
        const dyPx = -dNdcY * (h / 2);
        try { this._mmbPan?.controller?.addOffsetPx?.(dxPx, dyPx); } catch (_) {}
      }
    }
  }

  /**
   * Включает/выключает MMB-pan (нажатое колесо + drag).
   * @param {boolean} enabled
   */
  setMiddleMousePanEnabled(enabled) {
    if (!this._mmbPan) return;
    this._mmbPan.enabled = !!enabled;
  }

  /**
   * Включает/выключает диагностическое логирование MMB-pan.
   * @param {boolean} debug
   */
  setMiddleMousePanDebug(debug) {
    if (!this._mmbPan) return;
    this._mmbPan.debug = !!debug;
  }

  /**
   * Возвращает текущие флаги MMB-pan (для диагностики).
   */
  getMiddleMousePanState() {
    if (!this._mmbPan) return { enabled: false, debug: false };
    return { enabled: !!this._mmbPan.enabled, debug: !!this._mmbPan.debug };
  }

  /**
   * Меняет FOV перспективной камеры, сохраняя кадрирование (масштаб объекта на экране) по текущему target.
   * Это позволяет "ослабить перспективу" без резкого зума.
   * @param {number} fovDeg
   * @param {{keepFraming?: boolean, log?: boolean}} [opts]
   */
  setPerspectiveFov(fovDeg, opts = {}) {
    const keepFraming = opts.keepFraming !== false;
    const log = opts.log !== false;
    if (!this.camera || !this.controls) return;
    if (!this.camera.isPerspectiveCamera) return;

    const nextFov = Number(fovDeg);
    if (!Number.isFinite(nextFov)) return;
    const clamped = Math.min(80, Math.max(10, nextFov));

    const prevFov = this.camera.fov;
    if (Math.abs(prevFov - clamped) < 1e-6) return;

    const target = this.controls.target.clone();
    const prevPos = this.camera.position.clone();
    const prevDist = prevPos.distanceTo(target);

    this.camera.fov = clamped;
    this.camera.updateProjectionMatrix();

    if (keepFraming) {
      // dist_new = dist_old * tan(fov_old/2) / tan(fov_new/2)
      const prev = (prevFov * Math.PI) / 180;
      const next = (clamped * Math.PI) / 180;
      const denom = Math.tan(next / 2);
      const num = Math.tan(prev / 2);
      if (Number.isFinite(denom) && denom > 1e-9 && Number.isFinite(num)) {
        const newDist = Math.max(0.01, prevDist * (num / denom));
        const dir = prevPos.clone().sub(target).normalize();
        this.camera.position.copy(target.clone().add(dir.multiplyScalar(newDist)));
        this.camera.updateProjectionMatrix();
      }
    }

    this.controls.update();
    if (log) {
      try {
        console.log('[Viewer][FOV]', {
          prevFov,
          nextFov: clamped,
          prevDist: +prevDist.toFixed(3),
          nextDist: +this.camera.position.distanceTo(target).toFixed(3),
        });
      } catch (_) {}
    }
  }

  _getAspect() {
    try {
      const { width, height } = this._getContainerSize();
      return Math.max(1e-6, width) / Math.max(1e-6, height);
    } catch (_) {
      return 1;
    }
  }

  _dumpProjectionDebug(label) {
    try {
      const cam = this.camera;
      const tgt = this.controls?.target;
      const isPersp = !!cam?.isPerspectiveCamera;
      const isOrtho = !!cam?.isOrthographicCamera;
      console.log('[Viewer][Projection]', label, {
        mode: this._projection?.mode,
        camera: isPersp ? 'perspective' : isOrtho ? 'ortho' : 'unknown',
        pos: cam?.position ? { x: +cam.position.x.toFixed(3), y: +cam.position.y.toFixed(3), z: +cam.position.z.toFixed(3) } : null,
        target: tgt ? { x: +tgt.x.toFixed(3), y: +tgt.y.toFixed(3), z: +tgt.z.toFixed(3) } : null,
        dist: (cam?.position && tgt) ? +cam.position.distanceTo(tgt).toFixed(3) : null,
        fov: isPersp ? cam.fov : null,
        zoom: isOrtho ? cam.zoom : null,
        near: cam?.near,
        far: cam?.far,
        composer: !!this._composer,
        renderPassHasCamera: !!this._renderPass?.camera,
        ssaoPassHasCamera: !!this._ssaoPass?.camera,
      });
    } catch (_) {}
  }

  init() {
    if (!this.container) throw new Error("Viewer: контейнер не найден");

    // Рендерер
    // logarithmicDepthBuffer: уменьшает z-fighting на почти копланарных поверхностях (часто в IFC).
    // Это заметно снижает "мигание" тонких накладных деталей на фасадах.
    // stencil: нужен для отрисовки "cap" по контуру сечения
    // Фон должен выглядеть белым всегда, но при этом сохраняем прежнее поведение рендера (прозрачный canvas),
    // чтобы не менять визуальное смешивание (тени/пост-эффекты) относительно версии "до белого фона".
    // Белизна обеспечивается фоном контейнера (IfcViewer.js), а canvas остаётся прозрачным.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true, stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false; // управляем очисткой вручную для мульти-проходов
    try { this.renderer.setClearColor(0xffffff, 0); } catch (_) {}
    // Тени по умолчанию выключены (включаются только через setShadowsEnabled)
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Спрячем канвас до первого корректного измерения
    this.renderer.domElement.style.visibility = "hidden";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.container.appendChild(this.renderer.domElement);

    // Базовые настройки рендера для корректного "выкл"
    this._baselineRenderer = {
      outputEncoding: this.renderer.outputEncoding,
      outputColorSpace: this.renderer.outputColorSpace,
      toneMapping: this.renderer.toneMapping,
      toneMappingExposure: this.renderer.toneMappingExposure,
      physicallyCorrectLights: this.renderer.physicallyCorrectLights,
      useLegacyLights: this.renderer.useLegacyLights,
    };

    // Сцена
    this.scene = new THREE.Scene();
    // Оставляем фон сцены прозрачным (белый фон задаётся контейнером).
    try { this.scene.background = null; } catch (_) {}
    // Оверлей-сцена для секущих манипуляторов (без клиппинга)
    this.sectionOverlayScene = new THREE.Scene();

    // Камера
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const aspect = width / height;
    // Перспектива: уменьшаем FOV (меньше "сужение" вдаль)
    this.camera = new THREE.PerspectiveCamera(20, aspect, 0.1, 1000);
    this.camera.position.set(-22.03, 3.17, 39.12);
    this.camera.lookAt(0, 0, 0);
    this._projection.persp = this.camera;

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 1;
    this.controls.maxDistance = 20;
    // Zoom для орто-режима (в перспективе OrbitControls эти поля просто не мешают)
    this.controls.minZoom = this._projection.minZoom;
    this.controls.maxZoom = this._projection.maxZoom;

    // Zoom-to-cursor: перехватываем wheel в capture-phase, чтобы OrbitControls не выполнял dolly сам
    try {
      this._zoomToCursor.controller = new ZoomToCursorController({
        domElement: this.renderer.domElement,
        getCamera: () => this.camera,
        getControls: () => this.controls,
        getPickRoot: () => this.activeModel,
        onZoomChanged: (force) => this._notifyZoomIfChanged(force),
        isEnabled: () => !!this._zoomToCursor.enabled,
        isDebug: () => !!this._zoomToCursor.debug,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("ZoomToCursor init failed:", e);
    }

    // MMB-pan: перехватываем pointerdown в capture-phase, чтобы OrbitControls не делал dolly на MMB
    try {
      this._mmbPan.controller = new MiddleMousePanController({
        domElement: this.renderer.domElement,
        getCamera: () => this.camera,
        getControls: () => this.controls,
        isEnabled: () => !!this._mmbPan.enabled,
        isDebug: () => !!this._mmbPan.debug,
        // Не стартуем пан, если нажали на overlay NavCube (иначе "тащит" камеру при клике по кубу)
        shouldIgnoreEvent: (e) => {
          try {
            return !!(this.navCube && typeof this.navCube._isInsideOverlay === "function" && this.navCube._isInsideOverlay(e.clientX, e.clientY));
          } catch (_) {
            return false;
          }
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("MMB-pan init failed:", e);
    }

    // RMB model move: перехватываем ПКМ и двигаем МОДЕЛЬ (activeModel), не трогая pivot (target)
    try {
      this._rmbModelMove.controller = new RightMouseModelMoveController({
        domElement: this.renderer.domElement,
        getCamera: () => this.camera,
        getControls: () => this.controls,
        getModel: () => this.activeModel,
        isEnabled: () => !!this._rmbModelMove.enabled,
        isDebug: () => !!this._rmbModelMove.debug,
        shouldIgnoreEvent: (e) => {
          try {
            return !!(this.navCube && typeof this.navCube._isInsideOverlay === "function" && this.navCube._isInsideOverlay(e.clientX, e.clientY));
          } catch (_) {
            return false;
          }
        },
        onRmbStart: (pivot) => {
          try { this._rmbModelMove.pivotAnchor = pivot?.clone?.() || null; } catch (_) { this._rmbModelMove.pivotAnchor = null; }
        },
        onRmbMove: (delta) => {
          // Двигаем "тень/землю/солнце" вместе с моделью, чтобы тень не отрывалась и не клипалась.
          try {
            if (!delta) return;
            if (this.shadowReceiver?.position?.add) {
              this.shadowReceiver.position.add(delta);
              this.shadowReceiver.updateMatrixWorld?.(true);
            }
            if (this.shadowGradient?.buildingCenterXZ?.add) {
              this.shadowGradient.buildingCenterXZ.add(new THREE.Vector2(delta.x || 0, delta.z || 0));
              this.#applyShadowGradientUniforms();
            }
            if (this.sunLight) {
              try { this.sunLight.position.add(delta); } catch (_) {}
              try {
                if (this.sunLight.target) {
                  this.sunLight.target.position.add(delta);
                  this.sunLight.target.updateMatrixWorld?.(true);
                }
              } catch (_) {}
              try { this.sunLight.updateMatrixWorld?.(true); } catch (_) {}
              try { this.sunLight.shadow && (this.sunLight.shadow.needsUpdate = true); } catch (_) {}
            }
          } catch (_) {}
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("RMB-model-move init failed:", e);
    }

    // Создадим вторую камеру "без перспективы" (orthographic), но не включаем её по умолчанию.
    // Фрустум подбираем так, чтобы при переключении вид менялся только за счёт перспективных искажений.
    try {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const vFov = (this.camera.fov * Math.PI) / 180;
      const halfH = Math.max(0.01, dist * Math.tan(vFov / 2));
      this._projection.orthoHalfHeight = halfH;
      const ortho = new THREE.OrthographicCamera(
        -halfH * aspect,
        halfH * aspect,
        halfH,
        -halfH,
        this.camera.near,
        this.camera.far
      );
      ortho.position.copy(this.camera.position);
      ortho.zoom = 1;
      ortho.updateProjectionMatrix();
      this._projection.ortho = ortho;
    } catch (_) {}

    // Свет
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(amb);
    this.ambientLight = amb;
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 5.9, 5);
    // Тени у источника тоже включаются только через setShadowsEnabled
    dir.castShadow = false;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.radius = this.shadowStyle.softness;
    this.scene.add(dir);
    this.sunLight = dir;
    this._sunBaseXZ = { x: dir.position.x, z: dir.position.z };

    // Плоскость-приёмник теней (под моделью). Позицию/размер выставим, когда появится модель.
    this.#ensureShadowReceiver();

    // Применим дефолтные флаги после создания света/приёмника
    this.setSunEnabled(true);
    this.setSunHeight(5.9);
    this.setShadowsEnabled(this.shadowsEnabled);

    // Локальная подсветка "внутри" (по умолчанию скрыта)
    this.#ensureInteriorAssistLight();

    // Демонстрационный куб отключён для чистого прелоадера
    // Оставим сцену пустой до загрузки модели
    // Добавим метод фокусировки объекта
    this.focusObject = (object3D, padding = 1.2) => {
      if (!object3D || !this.camera || !this.controls) return;
      const box = new THREE.Box3().setFromObject(object3D);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // Вычисляем дистанцию вписывания с учётом аспекта
      const dist = this.#computeFitDistanceForSize(size, padding);
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(center);
      this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
      this.camera.updateProjectionMatrix();
      this.controls.update();
    };

    // Навигационный куб (интерактивный overlay в правом верхнем углу)
    this.navCube = new NavCube(this.renderer, this.camera, this.controls, this.container, {
      sizePx: 96,
      marginPx: 10,
      opacity: 0.6,
      // Home-кнопка NavCube: возвращаем ТОЛЬКО камеру (не трогаем инструменты/сечения/стили)
      onHome: () => this.goHomeViewOnly(),
    });

    // Визуальная ось вращения: события мыши и контролов
    this._onPointerDown = (e) => {
      this._lastPointerDownButton = e?.button;
      if (e.button === 0) this._isLmbDown = true;
    };
    this._onPointerUp = (e) => {
      // Сбросим "последнюю кнопку" на отпускании, чтобы не использовать устаревшее значение.
      this._lastPointerDownButton = null;
      if (e.button === 0) { this._isLmbDown = false; this.#hideRotationAxisLine(); }
    };
    this._onPointerMove = (e) => {
      const rect = this.renderer?.domElement?.getBoundingClientRect?.();
      if (!rect) return;
      // Копим абсолютный сдвиг курсора для простого порога
      const now = { x: e.clientX, y: e.clientY };
      if (!this._lastPointer) this._lastPointer = now;
      const dx = Math.abs(now.x - this._lastPointer.x);
      const dy = Math.abs(now.y - this._lastPointer.y);
      this._recentPointerDelta = dx + dy;
      this._lastPointer = now;
    };
    // Capture-phase: чтобы успеть выставить флаги до OrbitControls (его start может прийти раньше bubble pointerdown)
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown, { capture: true, passive: true });
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp, { passive: true });
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove, { passive: true });

    this._onControlsStart = () => {
      // Инициализируем предыдущий вектор направления вида
      if (!this.camera || !this.controls) return;
      // Если стартовали вращение ЛКМ после zoom-to-cursor, то target мог сместиться к "углу".
      // Возвращаем pivot к центру модели (как при загрузке), сохраняя кадр.
      if (this._lastPointerDownButton === 0) this.#rebaseRotatePivotToModelCenterIfNeeded();
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this._prevViewDir = dir;
      this._smoothedAxis = null;
      if (this._damping.dynamic) {
        this.controls.dampingFactor = this._damping.base;
        this._damping.isSettling = false;
        this.controls.enableDamping = true;
      }
    };
    this._onControlsChange = () => {
      // Обновляем ось только при зажатой ЛКМ (вращение)
      if (!this._isLmbDown) return;
      this.#updateRotationAxisLine();
    };
    this._onControlsEnd = () => {
      this.#hideRotationAxisLine();
      if (this._damping.dynamic && this.controls) {
        this._damping.isSettling = true;
        this._damping.lastEndTs = performance.now();
        this.controls.enableDamping = true;
      }
    };
    this.controls.addEventListener('start', this._onControlsStart);
    this.controls.addEventListener('change', this._onControlsChange);
    this.controls.addEventListener('end', this._onControlsEnd);

    // Визуализация секущих плоскостей (манипуляторы с квадратиком и стрелкой)
    this.#initClippingGizmos();

    // Обработчики изменения размеров
    window.addEventListener("resize", this.handleResize);
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        const w = Math.max(1, Math.floor(cr.width));
        const h = Math.max(1, Math.floor(cr.height));
        this._updateSize(w, h);
        // После первого валидного измерения показываем канвас
        this.renderer.domElement.style.visibility = "visible";
      }
    });
    this.resizeObserver.observe(this.container);
    // Первичная попытка подгонки
    const { width: initW, height: initH } = this._getContainerSize();
    this._updateSize(Math.max(1, initW), Math.max(1, initH));

    // Старт цикла
    this.animate();

    // Сохраним Home-снапшот после инициализации
    this._home.cameraPos = this.camera.position.clone();
    this._home.target = this.controls.target.clone();
    this._home.perspFov = (this.camera && this.camera.isPerspectiveCamera) ? this.camera.fov : (this._projection?.persp?.fov ?? 20);
    this._home.edgesVisible = this.edgesVisible;
    this._home.flatShading = this.flatShading;
    this._home.quality = this.quality;
    this._home.clipEnabled = this.clipping.planes.map(p => p.constant);
    // Модель может быть ещё не загружена — modelTransform снимем после replaceWithModel()

    // Сигнал о готовности после первого кадра
    requestAnimationFrame(() => {
      this._dispatchReady();
    });
  }

  handleResize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const { width, height } = this._getContainerSize();
    this._updateSize(Math.max(1, width), Math.max(1, height));
    // Обновим пределы зума под текущий объект без переразмещения камеры (только в перспективе)
    const subject = this.activeModel || this.demoCube;
    if (subject && this.camera.isPerspectiveCamera) this.applyAdaptiveZoomLimits(subject, { recenter: false });
    // Обновим вспомогательные overlay-виджеты
    if (this.navCube) this.navCube.onResize();
  }

  animate() {
    if (this.autoRotateDemo && this.demoCube) {
      this.demoCube.rotation.y += 0.01;
      this.demoCube.rotation.x += 0.005;
    }

    if (this.controls) {
      this.#updateDynamicDamping();
      this.controls.update();
    }
    // "Внутренняя" подсветка/пост-эффекты: включаются только когда камера внутри модели
    this.#updateInteriorAssist();
    this._notifyZoomIfChanged();
    if (this.renderer && this.camera && this.scene) {
      // Применим ТОЛЬКО активные (конечные) плоскости отсечения
      const activePlanes = this.clipping.planes.filter((p) => isFinite(p.constant));
      this.renderer.clippingPlanes = activePlanes.length > 0 ? activePlanes : [];
      this.renderer.localClippingEnabled = activePlanes.length > 0;
      // Обновим манипуляторы секущих плоскостей
      this.#updateClippingGizmos();
      // Рендер основной сцены
      this.renderer.clear(true, true, true);
      const useComposer = !!(this._composer && (this.visual?.ao?.enabled || this.visual?.color?.enabled || this._step4?.enabled));
      if (useComposer) {
        this._composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
        // Cap (закрытие среза) в режиме без композера
        try {
          const subject = this.activeModel || this.demoCube;
          this._sectionCaps?.render?.({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            subject,
            activePlanes,
          });
        } catch (_) {}
      }
      // Рендер оверлея манипуляторов без глобального клиппинга поверх
      const prevLocal = this.renderer.localClippingEnabled;
      const prevPlanes = this.renderer.clippingPlanes;
      this.renderer.localClippingEnabled = false;
      this.renderer.clippingPlanes = [];
      this.renderer.clearDepth();
      this.renderer.render(this.sectionOverlayScene, this.camera);
      // Восстановление настроек клиппинга
      this.renderer.localClippingEnabled = prevLocal;
      this.renderer.clippingPlanes = prevPlanes;
    }
    // Рендер навигационного куба поверх основной сцены
    if (this.navCube) this.navCube.renderOverlay();
    this.animationId = requestAnimationFrame(this.animate);
  }

  #updateDynamicDamping() {
    if (!this.controls) return;
    if (!this._damping.dynamic || !this.controls.enableDamping) return;
    if (this._damping.isSettling) {
      const now = performance.now();
      if (now - this._damping.lastEndTs <= this._damping.settleMs) {
        this.controls.dampingFactor = this._damping.settle;
      } else {
        this._damping.isSettling = false;
        this.controls.dampingFactor = this._damping.base;
      }
    } else {
      this.controls.dampingFactor = this._damping.base;
    }
  }

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.handleResize);

    // Освободим манипуляторы секущих плоскостей до удаления канваса
    if (this.clipping?.manipulators) {
      const { x, y, z } = this.clipping.manipulators;
      x && x.dispose && x.dispose();
      y && y.dispose && y.dispose();
      z && z.dispose && z.dispose();
      this.clipping.manipulators.x = null;
      this.clipping.manipulators.y = null;
      this.clipping.manipulators.z = null;
    }

    // Снимем события оси вращения
    if (this.renderer?.domElement) {
      try { this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown); } catch(_) {}
      try { this.renderer.domElement.removeEventListener('pointerup', this._onPointerUp); } catch(_) {}
      try { this.renderer.domElement.removeEventListener('pointermove', this._onPointerMove); } catch(_) {}
    }
    // Снимем wheel zoom-to-cursor
    try { this._zoomToCursor?.controller?.dispose?.(); } catch (_) {}
    if (this._zoomToCursor) this._zoomToCursor.controller = null;
    // Снимем MMB-pan
    try { this._mmbPan?.controller?.dispose?.(); } catch (_) {}
    if (this._mmbPan) this._mmbPan.controller = null;
    // Снимем RMB model move
    try { this._rmbModelMove?.controller?.dispose?.(); } catch (_) {}
    if (this._rmbModelMove) this._rmbModelMove.controller = null;
    if (this.controls) {
      try { this.controls.removeEventListener('start', this._onControlsStart); } catch(_) {}
      try { this.controls.removeEventListener('change', this._onControlsChange); } catch(_) {}
      try { this.controls.removeEventListener('end', this._onControlsEnd); } catch(_) {}
    }
    if (this.rotationAxisLine && this.scene) {
      try { this.scene.remove(this.rotationAxisLine); } catch(_) {}
      if (this.rotationAxisLine.geometry?.dispose) this.rotationAxisLine.geometry.dispose();
      if (this.rotationAxisLine.material?.dispose) this.rotationAxisLine.material.dispose();
      this.rotationAxisLine = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    if (this._composer) {
      try { this._composer.dispose?.(); } catch (_) {}
      this._composer = null;
      this._renderPass = null;
      this._ssaoPass = null;
      this._hueSatPass = null;
      this._bcPass = null;
      this._step4Pass = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
    if (this.navCube) {
      this.navCube.dispose();
      this.navCube = null;
    }
    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry && obj.geometry.dispose && obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((mi) => mi && mi.dispose && mi.dispose());
          else if (m && m.dispose) m.dispose();
        }
      });
    }
    if (this.shadowReceiver) {
      try { this.scene?.remove(this.shadowReceiver); } catch (_) {}
      try { this.shadowReceiver.geometry?.dispose?.(); } catch (_) {}
      try { this.shadowReceiver.material?.dispose?.(); } catch (_) {}
      this.shadowReceiver = null;
    }
    if (this.sectionOverlayScene) {
      this.sectionOverlayScene.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry && obj.geometry.dispose && obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((mi) => mi && mi.dispose && mi.dispose());
          else if (m && m.dispose) m.dispose();
        }
        if (obj.isLineSegments || obj.isLine) {
          obj.geometry && obj.geometry.dispose && obj.geometry.dispose();
          obj.material && obj.material.dispose && obj.material.dispose();
        }
      });
      this.sectionOverlayScene = null;
    }

    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }

  // --- Zoom API ---
  getDistance() {
    if (!this.camera || !this.controls) return 0;
    return this.camera.position.distanceTo(this.controls.target);
  }

  getZoomPercent() {
    if (!this.controls) return 0;
    if (this.camera?.isOrthographicCamera) {
      const z = this.camera.zoom || 1;
      const minZ = this.controls.minZoom ?? this._projection.minZoom;
      const maxZ = this.controls.maxZoom ?? this._projection.maxZoom;
      const clampedZ = Math.min(Math.max(z, minZ), maxZ);
      const t = (clampedZ - minZ) / (maxZ - minZ);
      return t * 100;
    }
    const d = this.getDistance();
    const minD = this.controls.minDistance || 1;
    const maxD = this.controls.maxDistance || 20;
    const clamped = Math.min(Math.max(d, minD), maxD);
    const t = (maxD - clamped) / (maxD - minD); // 0..1
    return t * 100; // 0%..100%
  }

  zoomIn(factor = 0.9) {
    if (!this.camera || !this.controls) return;
    if (this.camera.isOrthographicCamera) {
      const minZ = this.controls.minZoom ?? this._projection.minZoom;
      const maxZ = this.controls.maxZoom ?? this._projection.maxZoom;
      const next = (this.camera.zoom || 1) * (1 / factor);
      this.camera.zoom = Math.min(Math.max(next, minZ), maxZ);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this._notifyZoomIfChanged(true);
      return;
    }
    this.#moveAlongView(factor);
  }

  zoomOut(factor = 1.1) {
    if (!this.camera || !this.controls) return;
    if (this.camera.isOrthographicCamera) {
      const minZ = this.controls.minZoom ?? this._projection.minZoom;
      const maxZ = this.controls.maxZoom ?? this._projection.maxZoom;
      const next = (this.camera.zoom || 1) * (1 / factor);
      this.camera.zoom = Math.min(Math.max(next, minZ), maxZ);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this._notifyZoomIfChanged(true);
      return;
    }
    this.#moveAlongView(factor);
  }

  #moveAlongView(scale) {
    const target = this.controls.target;
    const position = this.camera.position.clone();
    const dir = position.sub(target).normalize();
    let dist = this.getDistance() * scale;
    dist = Math.min(Math.max(dist, this.controls.minDistance), this.controls.maxDistance);
    const newPos = target.clone().add(dir.multiplyScalar(dist));
    this.camera.position.copy(newPos);
    this.camera.updateProjectionMatrix();
    if (this.controls) this.controls.update();
    this._notifyZoomIfChanged(true);
  }

  // Адаптивная настройка пределов зума под габариты объекта
  applyAdaptiveZoomLimits(object3D, options = {}) {
    if (!object3D || !this.camera || !this.controls) return;
    // Для орто-камеры эта функция (fit по FOV) не применима — здесь мы сознательно не меняем кадр.
    if (this.camera.isOrthographicCamera) return;
    const padding = options.padding ?? 1.2;      // запас на краях кадра
    const slack = options.slack ?? 2.5;          // во сколько раз можно отъехать дальше «вписанной» дистанции
    const minRatio = options.minRatio ?? 0.05;   // минимальная дистанция как доля от «вписанной»
    const recenter = options.recenter ?? false;  // перемещать ли камеру на «вписанную» дистанцию

    const box = new THREE.Box3().setFromObject(object3D);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const fitDist = this.#computeFitDistanceForSize(size, padding);

    const newMin = Math.max(0.01, fitDist * Math.max(0.0, minRatio));
    const newMax = Math.max(newMin * 1.5, fitDist * Math.max(1.0, slack));
    this.controls.maxDistance = newMax;
    this.controls.minDistance = newMin;

    // Настройка near/far для стабильной глубины (уменьшает z-fighting на тонких/накладных деталях).
    // Важно: far должен быть "как можно меньше", но достаточен для maxDistance.
    // near не должен быть слишком маленьким относительно far.
    const desiredNear = Math.max(0.05, fitDist * 0.001);     // 0.1% от вписанной дистанции (но не меньше 0.05)
    const desiredFar = Math.max(50, newMax * 4);             // гарантированно покрываем maxDistance
    // Защитимся от некорректного отношения near/far
    const safeNear = Math.min(desiredNear, desiredFar / 1000);
    const safeFar = Math.max(desiredFar, safeNear * 1000);
    if (this.camera.near !== safeNear || this.camera.far !== safeFar) {
      this.camera.near = safeNear;
      this.camera.far = safeFar;
      this.camera.updateProjectionMatrix();
    }

    if (recenter) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(center);
      this.camera.position.copy(center.clone().add(dir.multiplyScalar(fitDist)));
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  /**
   * Кадрирует объект так, чтобы он гарантированно помещался в "безопасной области" кадра.
   * Идея безопасной области задаётся сеткой: например 4×4, и объект должен занимать
   * не больше spanCols×spanRows в центре (по умолчанию 2×2, т.е. ~50% по ширине/высоте).
   *
   * - Для Perspective: подбираем дистанцию через bbox и текущий aspect + FOV.
   * - Для Ortho: подбираем zoom (и при необходимости расширяем orthoHalfHeight), чтобы bbox поместился.
   *
   * @param {THREE.Object3D} object3D
   * @param {Object} [opts]
   * @param {number} [opts.gridCols=4]
   * @param {number} [opts.gridRows=4]
   * @param {number} [opts.spanCols=2]
   * @param {number} [opts.spanRows=2]
   * @param {number} [opts.extraPadding=1.05] - доп. запас поверх математического fit (>=1)
   * @param {number} [opts.perspectiveFov=20] - целевой FOV для perspective
   * @param {THREE.Vector3} [opts.viewDir] - направление от цели к камере (front-right-top)
   * @param {boolean} [opts.log=false]
   * @returns {{center:THREE.Vector3,size:THREE.Vector3,padding:number,mode:string}|null}
   */
  frameObjectToViewportGrid(object3D, opts = {}) {
    if (!object3D || !this.camera || !this.controls) return null;

    const {
      gridCols = 4,
      gridRows = 4,
      spanCols = 2,
      spanRows = 2,
      extraPadding = 1.05,
      perspectiveFov = 20,
      viewDir = null,
      log = false,
    } = opts || {};

    const box = new THREE.Box3().setFromObject(object3D);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const safeRX = Math.max(1e-6, Math.min(1, Number(spanCols) / Math.max(1, Number(gridCols))));
    const safeRY = Math.max(1e-6, Math.min(1, Number(spanRows) / Math.max(1, Number(gridRows))));
    const safeR = Math.max(1e-6, Math.min(safeRX, safeRY));
    const padding = Math.max(1.0, (1 / safeR) * Math.max(1.0, Number(extraPadding) || 1.0));

    // Направление вида: по умолчанию "front-right-top" в текущей сцене.
    // Важно: в некоторых IFC/сценах "front/right" может не совпадать со знаками мировых осей,
    // поэтому вектор легко переопределяется через opts.viewDir.
    let dir = null;
    if (viewDir && viewDir.isVector3) dir = viewDir.clone();
    else dir = new THREE.Vector3(-1, 0.6, 1);
    const dirLen = dir.length();
    if (dirLen > 1e-6) dir.multiplyScalar(1 / dirLen);
    else dir.set(0, 0.2, 1).normalize();
    const dirN = dir.clone(); // нормализованный (для логов и вычислений без мутаций)

    // Строго по центру bbox
    this.controls.target.copy(center);

    const aspect = this._getAspect?.() || (this.camera.aspect || 1);

    if (this.camera.isPerspectiveCamera) {
      const fov = Number.isFinite(Number(perspectiveFov)) ? Number(perspectiveFov) : this.camera.fov;
      if (Number.isFinite(fov) && fov > 1e-3 && fov < 179) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      try {
        if (this.camera.aspect !== aspect) {
          this.camera.aspect = aspect;
          this.camera.updateProjectionMatrix();
        }
      } catch (_) {}

      const dist = this.#computeFitDistanceForSize(size, padding);
      this.camera.position.copy(center.clone().add(dirN.clone().multiplyScalar(dist)));
      this.camera.updateProjectionMatrix();
      this.controls.update();

      if (log) {
        // eslint-disable-next-line no-console
        console.log('[Viewer] frameObjectToViewportGrid(persp)', {
          grid: { gridCols, gridRows, spanCols, spanRows, safeRX, safeRY, padding },
          bbox: {
            size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
            center: { x: +center.x.toFixed(3), y: +center.y.toFixed(3), z: +center.z.toFixed(3) },
          },
          camera: { fov: this.camera.fov, aspect: this.camera.aspect, dist: +dist.toFixed(3) },
          viewDir: { x: +dirN.x.toFixed(3), y: +dirN.y.toFixed(3), z: +dirN.z.toFixed(3) },
        });
      }

      return { center, size, padding, mode: 'perspective' };
    }

    if (this.camera.isOrthographicCamera) {
      const safeSizeX = Math.max(1e-6, size.x);
      const safeSizeY = Math.max(1e-6, size.y);
      const fitHeight = Math.max(safeSizeY, safeSizeX / Math.max(1e-6, aspect));
      const neededHalfVisible = (fitHeight * padding) / 2;

      let halfH = this._projection?.orthoHalfHeight || Math.abs(this.camera.top) || 10;
      halfH = Math.max(0.01, halfH);

      const minZoom = this.controls?.minZoom ?? this._projection?.minZoom ?? 0.25;
      const maxZoom = this.controls?.maxZoom ?? this._projection?.maxZoom ?? 8;

      let zoomFit = halfH / Math.max(1e-6, neededHalfVisible);

      if (zoomFit < minZoom) {
        halfH = Math.max(halfH, neededHalfVisible * minZoom);
        try { this._projection.orthoHalfHeight = halfH; } catch (_) {}
        try {
          this.camera.left = -halfH * aspect;
          this.camera.right = halfH * aspect;
          this.camera.top = halfH;
          this.camera.bottom = -halfH;
        } catch (_) {}
        zoomFit = halfH / Math.max(1e-6, neededHalfVisible);
      }

      const zoom = Math.min(maxZoom, zoomFit);
      this.camera.zoom = Math.max(1e-6, zoom);

      const dist = Math.max(1.0, size.length());
      this.camera.position.copy(center.clone().add(dirN.clone().multiplyScalar(dist)));

      this.camera.updateProjectionMatrix();
      this.controls.update();

      if (log) {
        // eslint-disable-next-line no-console
        console.log('[Viewer] frameObjectToViewportGrid(ortho)', {
          grid: { gridCols, gridRows, spanCols, spanRows, safeRX, safeRY, padding },
          bbox: {
            size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
            center: { x: +center.x.toFixed(3), y: +center.y.toFixed(3), z: +center.z.toFixed(3) },
          },
          ortho: {
            aspect: +aspect.toFixed(3),
            halfH: +halfH.toFixed(3),
            neededHalfVisible: +neededHalfVisible.toFixed(3),
            zoom: +this.camera.zoom.toFixed(3),
            minZoom,
            maxZoom,
          },
          viewDir: { x: +dirN.x.toFixed(3), y: +dirN.y.toFixed(3), z: +dirN.z.toFixed(3) },
        });
      }

      return { center, size, padding, mode: 'ortho' };
    }

    return { center, size, padding, mode: 'unknown' };
  }

  // Вычисляет дистанцию до объекта, при которой он полностью помещается в кадр
  #computeFitDistanceForSize(size, padding = 1.2) {
    // Защита от нулевых размеров
    const safeSizeX = Math.max(1e-6, size.x);
    const safeSizeY = Math.max(1e-6, size.y);
    const aspect = this.camera.aspect || 1;
    const vFov = (this.camera.fov * Math.PI) / 180; // вертикальный FOV в радианах
    // Требуемая «высота» кадра: максимум между реальной высотой и шириной, приведённой к высоте через аспект
    const fitHeight = Math.max(safeSizeY, safeSizeX / aspect);
    const dist = (fitHeight * padding) / (2 * Math.tan(vFov / 2));
    return Math.max(0.01, dist);
  }

  addZoomListener(listener) {
    this.zoomListeners.add(listener);
  }

  removeZoomListener(listener) {
    this.zoomListeners.delete(listener);
  }

  _notifyZoomIfChanged(force = false) {
    const p = this.getZoomPercent();
    const rounded = Math.round(p);
    if (force || this.lastZoomPercent !== rounded) {
      this.lastZoomPercent = rounded;
      this.zoomListeners.forEach((fn) => {
        try { fn(rounded); } catch (_) {}
      });
    }
  }

  _getContainerSize() {
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || this.container.clientWidth || 1;
    const height = rect.height || this.container.clientHeight || 1;
    return { width, height };
  }

  _updateSize(width, height) {
    if (!this.camera || !this.renderer) return;
    const aspect = width / height;
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.isOrthographicCamera) {
      const h = this._projection.orthoHalfHeight || 10;
      this.camera.left = -h * aspect;
      this.camera.right = h * aspect;
      this.camera.top = h;
      this.camera.bottom = -h;
      this.camera.updateProjectionMatrix();
    }
    // Третий аргумент false — не менять стилевые размеры, только буфер
    this.renderer.setSize(width, height, false);
    if (this._composer) {
      try { this._composer.setSize(width, height); } catch (_) {}
    }
    if (this._ssaoPass?.setSize) {
      try { this._ssaoPass.setSize(width, height); } catch (_) {}
    }
    // Обновляем FXAA resolution при изменении размера
    if (this._fxaaPass) {
      try {
        this._fxaaPass.material.uniforms['resolution'].value.x = 1 / Math.max(1, width);
        this._fxaaPass.material.uniforms['resolution'].value.y = 1 / Math.max(1, height);
      } catch (_) {}
    }

    // Если активен MMB-pan (viewOffset), нужно переустановить его под новый размер
    try { this._mmbPan?.controller?.applyCurrentOffset?.(width, height); } catch (_) {}
  }

  // ================= Projection (Perspective / Ortho) =================
  getProjectionMode() {
    return this._projection?.mode || 'perspective';
  }

  setProjectionMode(mode) {
    const next = (mode === 'ortho') ? 'ortho' : 'perspective';
    if (!this.camera || !this.controls || !this._projection?.persp || !this._projection?.ortho) return;
    if (next === this._projection.mode) return;

    this._dumpProjectionDebug('before');

    const target = this.controls.target.clone();
    const currentPos = this.camera.position.clone();
    const dirVec = currentPos.clone().sub(target);
    const dirLen = dirVec.length();
    const viewDir = dirLen > 1e-6 ? dirVec.multiplyScalar(1 / dirLen) : new THREE.Vector3(0, 0, 1);
    const aspect = this._getAspect();

    if (next === 'ortho') {
      // Подбираем фрустум под текущий perspective-вью: halfH = dist * tan(fov/2)
      const persp = this._projection.persp;
      const dist = Math.max(0.01, currentPos.distanceTo(target));
      const vFov = (persp.fov * Math.PI) / 180;
      const halfH = Math.max(0.01, dist * Math.tan(vFov / 2));
      this._projection.orthoHalfHeight = halfH;

      const ortho = this._projection.ortho;
      ortho.left = -halfH * aspect;
      ortho.right = halfH * aspect;
      ortho.top = halfH;
      ortho.bottom = -halfH;
      ortho.near = this.camera.near;
      ortho.far = this.camera.far;
      ortho.position.copy(currentPos);
      ortho.zoom = 1;
      ortho.updateProjectionMatrix();

      this.camera = ortho;
    } else {
      // Перевод Ortho → Perspective с сохранением масштаба в кадре:
      // видимая halfHeight = orthoHalfHeight / zoom => dist = halfVisible / tan(fov/2)
      const persp = this._projection.persp;
      const ortho = this._projection.ortho;
      const zoom = ortho.zoom || 1;
      const halfVisible = Math.max(0.01, (this._projection.orthoHalfHeight || Math.abs(ortho.top) || 10) / zoom);
      const vFov = (persp.fov * Math.PI) / 180;
      const dist = Math.max(0.01, halfVisible / Math.tan(vFov / 2));

      persp.near = this.camera.near;
      persp.far = this.camera.far;
      persp.aspect = aspect;
      persp.position.copy(target.clone().add(viewDir.multiplyScalar(dist)));
      persp.updateProjectionMatrix();

      this.camera = persp;
    }

    this._projection.mode = next;

    // Переключаем controls на новую камеру
    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.controls.update();

    // ViewOffset (MMB-pan) должен примениться к новой камере, если он включён
    try { this._mmbPan?.controller?.applyCurrentOffset?.(); } catch (_) {}

    // Внутренние зависимости, которые держат ссылку на camera
    if (this.navCube) this.navCube.mainCamera = this.camera;
    try {
      if (this._renderPass) this._renderPass.camera = this.camera;
      if (this._ssaoPass) this._ssaoPass.camera = this.camera;
    } catch (_) {}
    try {
      ['x', 'y', 'z'].forEach((axis) => {
        const m = this.clipping?.manipulators?.[axis];
        if (m) m.camera = this.camera;
      });
    } catch (_) {}

    this._dumpProjectionDebug('after');
  }

  toggleProjection() {
    const next = (this.getProjectionMode() === 'ortho') ? 'perspective' : 'ortho';
    this.setProjectionMode(next);
    return this.getProjectionMode();
  }

  _dispatchReady() {
    try {
      this.container.dispatchEvent(new CustomEvent("viewer:ready", { bubbles: true }));
    } catch (_) {}
  }

  // Заменяет демо-куб на реальную модель и отключает автоповорот
  replaceWithModel(object3D) {
    if (!object3D) return;
    // Удалить предыдущую модель
    if (this.activeModel) {
      this.scene.remove(this.activeModel);
      this.#disposeObject(this.activeModel);
      this.activeModel = null;
    }
    // Удалить демо-куб
    if (this.demoCube) {
      this.scene.remove(this.demoCube);
      this.#disposeObject(this.demoCube);
      this.demoCube = null;
    }
    this.autoRotateDemo = false;
    this.activeModel = object3D;
    this.scene.add(object3D);

    // Сброс MMB-pan (viewOffset) при загрузке новой модели:
    // иначе экранный сдвиг может "унести" модель из кадра даже при корректном кадрировании по bbox.
    try { this._mmbPan?.controller?.reset?.(); } catch (_) {}

    // Пересчитать плоскость под моделью (3x по площади bbox по X/Z)
    this.#updateShadowReceiverFromModel(object3D);

    // Подчеркнуть грани: полигон оффсет + контуры
    object3D.traverse?.((node) => {
      if (node.isMesh) {
        // Тени управляются единообразно через setShadowsEnabled()
        node.castShadow = !!this.shadowsEnabled;
        // Самозатенение: в тест-пресете ИЛИ при активном сечении
        node.receiveShadow = this.#getModelReceiveShadowEnabled();
        // Стекло/прозрачность: рендерим после непрозрачных (уменьшает мерцание сортировки)
        try {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          const anyTransparent = mats.some((m) => !!m && !!m.transparent && (Number(m.opacity ?? 1) < 0.999));
          node.renderOrder = anyTransparent ? 10 : 0;
        } catch (_) {}
        this.#applyPolygonOffsetToMesh(node, this.flatShading);
        this.#attachEdgesToMesh(node, this.edgesVisible);
      }
    });

    // Материальный пресет (если выбран не original)
    this.#applyMaterialStyleToModel(object3D);
    // Синхронизируем "сечение → shadow-pass" для материалов после назначения пресета
    this.#applyClipShadowsToModelMaterials();

    // Настроим пределы зума под габариты модели (кадрирование делаем отдельно ниже, на следующем кадре).
    // Здесь важно в первую очередь "оздоровить" near/far под размер модели.
    this.applyAdaptiveZoomLimits(object3D, { padding: 2.1, slack: 2.5, minRatio: 0.05, recenter: false });

    // Если "Тест" активен, сразу применим его к только что загруженной модели (самозатенение + shadow camera по bbox)
    if (this._testPreset?.enabled) {
      try { this.#applyTestPresetToScene(); } catch (_) {}
    }

    // На следующем кадре выставим кадрирование "в безопасной зоне" (2×2 из 4×4) и ракурс front-right-top.
    try {
      requestAnimationFrame(() => {
        if (!this.camera || !this.controls) return;
        // Логирование включается через ?frameDebug=1
        let log = false;
        try {
          const params = new URLSearchParams(window.location.search);
          log = params.get('frameDebug') === '1';
        } catch (_) {}

        // Кадрируем строго по центру bbox и с запасом (2×2 из 4×4 => padding≈2.0, +extraPadding)
        try {
          this.frameObjectToViewportGrid?.(object3D, {
            gridCols: 4,
            gridRows: 4,
            spanCols: 2,
            spanRows: 2,
            extraPadding: 1.05,
            perspectiveFov: 20,
            viewDir: new THREE.Vector3(-1, 0.6, 1), // front-right-top
            log,
          });
        } catch (_) {}

        // После выставления камеры — ещё раз подстроим near/far и лимиты зума под новый кадр.
        try { this.applyAdaptiveZoomLimits(object3D, { padding: 2.1, slack: 2.5, minRatio: 0.05, recenter: false }); } catch (_) {}

        // Снимем актуальный «домашний» вид после всех корректировок
        this._home.cameraPos = this.camera.position.clone();
        this._home.target = this.controls.target.clone();
        this._home.perspFov = (this.camera && this.camera.isPerspectiveCamera) ? this.camera.fov : (this._projection?.persp?.fov ?? this._home.perspFov ?? 20);
        this._home.edgesVisible = this.edgesVisible;
        this._home.flatShading = this.flatShading;
        this._home.quality = this.quality;
        this._home.clipEnabled = this.clipping.planes.map(p => p.constant);

        // Снимем исходный трансформ модели для Home (ПКМ-сдвиги должны сбрасываться)
        try {
          const m = this.activeModel;
          if (m) {
            this._home.modelTransform = {
              position: m.position.clone(),
              quaternion: m.quaternion.clone(),
              scale: m.scale.clone(),
            };
          }
        } catch (_) {}

        // Снимем исходное положение тени/земли, чтобы Home возвращал их вместе с моделью
        try {
          this._home.shadowReceiverPos = this.shadowReceiver?.position?.clone?.() || null;
        } catch (_) { this._home.shadowReceiverPos = null; }
        try {
          this._home.sunTargetPos = this.sunLight?.target?.position?.clone?.() || null;
        } catch (_) { this._home.sunTargetPos = null; }
        try {
          this._home.shadowGradCenterXZ = this.shadowGradient?.buildingCenterXZ?.clone?.() || null;
        } catch (_) { this._home.shadowGradCenterXZ = null; }

        // После загрузки модели сбрасываем "фиксированную ось" от ПКМ
        try { if (this._rmbModelMove) this._rmbModelMove.pivotAnchor = null; } catch (_) {}
      });
    } catch(_) {}
  }

  #disposeObject(obj) {
    obj.traverse?.((node) => {
      if (node.isMesh) {
        // Удалить и освободить дочерние линии-контуры, если есть
        const toRemove = [];
        node.children?.forEach((c) => {
          if (c.isLineSegments || c.isLine) toRemove.push(c);
        });
        toRemove.forEach((c) => {
          if (c.geometry?.dispose) c.geometry.dispose();
          if (c.material?.dispose) c.material.dispose();
          node.remove(c);
        });

        // Геометрия/материалы самого меша
        node.geometry && node.geometry.dispose && node.geometry.dispose();
        const m = node.material;
        if (Array.isArray(m)) m.forEach((mi) => mi && mi.dispose && mi.dispose());
        else if (m && m.dispose) m.dispose();
      }
      if (node.isLineSegments || node.isLine) {
        node.geometry && node.geometry.dispose && node.geometry.dispose();
        node.material && node.material.dispose && node.material.dispose();
      }
    });
  }

  #applyPolygonOffsetToMesh(mesh, flat) {
    const apply = (mat) => {
      if (!mat) return;
      mat.polygonOffset = true;
      // Умеренные значения polygon offset для уменьшения z-fighting
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 1;
      // Улучшим читаемость плоскостей
      if ("flatShading" in mat) {
        mat.flatShading = !!flat;
        mat.needsUpdate = true;
      }
    };
    if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
    else apply(mesh.material);
  }

  #ensureShadowReceiver() {
    if (!this.scene || this.shadowReceiver) return;
    // ShadowMaterial рисует только тени, сама плоскость прозрачная.
    // Если тени отключены — визуально ничего не изменится.
    const mat = new THREE.ShadowMaterial({ opacity: this.shadowStyle.opacity, color: this._shadowReceiverBaseColor.clone() });
    // Градиент тени: модифицируем шейдер только приёмника (не влияет на остальные материалы)
    mat.onBeforeCompile = (shader) => {
      // uniforms
      shader.uniforms.uShadowGradEnabled = { value: this.shadowGradient.enabled ? 1.0 : 0.0 };
      shader.uniforms.uShadowGradLength = { value: this.shadowGradient.length };
      shader.uniforms.uShadowGradStrength = { value: this.shadowGradient.strength };
      shader.uniforms.uShadowGradCurve = { value: this.shadowGradient.curve };
      shader.uniforms.uBuildingCenterXZ = { value: this.shadowGradient.buildingCenterXZ.clone() };
      shader.uniforms.uBuildingHalfSizeXZ = { value: this.shadowGradient.buildingHalfSizeXZ.clone() };

      // сохраняем ссылку для последующих обновлений
      this.shadowGradient._shader = shader;

      // varying world position
      if (!shader.vertexShader.includes('varying vec3 vWorldPosition')) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldPosition;'
        );
      }
      // worldpos_vertex в three определяет worldPosition; используем его
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vWorldPosition = worldPosition.xyz;'
      );

      if (!shader.fragmentShader.includes('varying vec3 vWorldPosition')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldPosition;\n' +
            'uniform float uShadowGradEnabled;\n' +
            'uniform float uShadowGradLength;\n' +
            'uniform float uShadowGradStrength;\n' +
            'uniform float uShadowGradCurve;\n' +
            'uniform vec2 uBuildingCenterXZ;\n' +
            'uniform vec2 uBuildingHalfSizeXZ;\n' +
            'float distToRect(vec2 p, vec2 c, vec2 h) {\n' +
            '  vec2 d = abs(p - c) - h;\n' +
            '  return length(max(d, 0.0));\n' +
            '}\n'
            + 'float computeShadowGrad(vec3 worldPos) {\n' +
            '  if (uShadowGradEnabled <= 0.5) return 1.0;\n' +
            '  float d = distToRect(worldPos.xz, uBuildingCenterXZ, uBuildingHalfSizeXZ);\n' +
            '  float t = clamp(d / max(1e-6, uShadowGradLength), 0.0, 1.0);\n' +
            '  float fade = smoothstep(0.0, 1.0, t);\n' +
            '  fade = pow(fade, max(0.05, uShadowGradCurve));\n' +
            '  return 1.0 - clamp(uShadowGradStrength, 0.0, 1.0) * fade;\n' +
            '}\n'
        );
      }

      let injected = false;
      if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          'gl_FragColor.a *= computeShadowGrad(vWorldPosition);\n#include <dithering_fragment>'
        );
        injected = true;
      } else if (shader.fragmentShader.includes('#include <fog_fragment>')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <fog_fragment>',
          'gl_FragColor.a *= computeShadowGrad(vWorldPosition);\n#include <fog_fragment>'
        );
        injected = true;
      } else {
        // Фолбэк: домножаем перед последней закрывающей скобкой файла
        const before = shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(/\}\s*$/, '  gl_FragColor.a *= computeShadowGrad(vWorldPosition);\n}');
        injected = before !== shader.fragmentShader;
      }

      // Диагностика (в консоль только если не удалось встроиться ожидаемым способом)
      if (!injected) {
        console.warn('[shadowReceiverGradient] Injection failed: no insertion point found');
      }
    };
    // стабильный ключ для кеша программы (чтобы onBeforeCompile применялся предсказуемо)
    mat.customProgramCacheKey = () => 'shadowReceiverGradient-v1';

    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    const plane = new THREE.Mesh(geo, mat);
    plane.name = "shadow-receiver";
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = !!this.shadowsEnabled;
    plane.castShadow = false;
    plane.visible = !!this.shadowsEnabled;
    // Чуть выше, чтобы избежать z-fighting с "нулевым" уровнем
    plane.position.set(0, -9999, 0); // спрячем до первого апдейта по модели
    this.scene.add(plane);
    this.shadowReceiver = plane;
    // Если "холодный свет" (Шаг 2) уже включён — сразу подкрасим тень тем же оттенком
    try { this.#applyShadowTintFromCoolLighting(); } catch (_) {}
  }

  #updateShadowReceiverFromModel(model) {
    if (!model) return;
    this.#ensureShadowReceiver();
    if (!this.shadowReceiver) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const minY = box.min.y;

      // Базовая плоскость: площадь = 3x площади объекта (bbox по X/Z).
      // => множитель по размерам = sqrt(3).
      const areaMultiplier = 3;
      const dimMul = Math.sqrt(areaMultiplier);

      // Доп. запас по X/Z из-за длины тени: высокая модель при наклонном солнце
      // может давать тень далеко за bbox по X/Z.
      // Оценка смещения тени по земле: displacementXZ ≈ height * |dirXZ| / |dirY|
      // где dir = (target - lightPos) нормализованный.
      let extraX = 0;
      let extraZ = 0;
      try {
        const sun = this.sunLight;
        if (sun) {
          const targetPos = (sun.target?.position?.clone?.() || center.clone());
          const dir = targetPos.sub(sun.position).normalize();
          const ay = Math.max(1e-3, Math.abs(dir.y));
          extraX = Math.abs(dir.x) * (Math.max(0, size.y) / ay);
          extraZ = Math.abs(dir.z) * (Math.max(0, size.y) / ay);
          // небольшой коэффициент запаса, чтобы не ловить «пограничные» обрезания
          const pad = 1.05;
          extraX *= pad;
          extraZ *= pad;
        }
      } catch (_) {
        extraX = 0;
        extraZ = 0;
      }

      this.shadowReceiver.position.set(center.x, minY + 0.001, center.z);
      // receiver.scale: X->world X, Y->world Z (PlaneGeometry is X/Y in local, rotated -90° around X)
      const receiverX = Math.max(0.001, (size.x * dimMul) + extraX * 2);
      const receiverZ = Math.max(0.001, (size.z * dimMul) + extraZ * 2);
      this.shadowReceiver.scale.set(receiverX, receiverZ, 1);
      this.shadowReceiver.updateMatrixWorld();

      // Обновим bbox здания для градиента тени (в XZ)
      this.shadowGradient.buildingCenterXZ.set(center.x, center.z);
      this.shadowGradient.buildingHalfSizeXZ.set(Math.max(0.001, size.x / 2), Math.max(0.001, size.z / 2));
      // Важно: длину градиента НЕ автокорректируем по размеру здания.
      // Она задаётся пользователем/дефолтами через setShadowGradientLength().
      this.#applyShadowGradientUniforms();

      // Подгоняем shadow-camera направленного света под габариты плоскости,
      // чтобы при включении теней они не "обрезались" слишком маленькой областью.
      if (this.sunLight) {
        const cam = this.sunLight.shadow.camera;
        const halfX = receiverX / 2;
        const halfZ = receiverZ / 2;
        cam.left = -halfX;
        cam.right = halfX;
        cam.top = halfZ;
        cam.bottom = -halfZ;
        cam.near = 0.1;
        cam.far = Math.max(50, size.y * 6);
        cam.updateProjectionMatrix();
      }
    } catch (_) {}
  }

  #applyShadowGradientUniforms() {
    const shader = this.shadowGradient?._shader;
    if (!shader) return;
    if (shader.uniforms?.uShadowGradEnabled) shader.uniforms.uShadowGradEnabled.value = this.shadowGradient.enabled ? 1.0 : 0.0;
    if (shader.uniforms?.uShadowGradLength) shader.uniforms.uShadowGradLength.value = this.shadowGradient.length;
    if (shader.uniforms?.uShadowGradStrength) shader.uniforms.uShadowGradStrength.value = this.shadowGradient.strength;
    if (shader.uniforms?.uShadowGradCurve) shader.uniforms.uShadowGradCurve.value = this.shadowGradient.curve;
    if (shader.uniforms?.uBuildingCenterXZ) shader.uniforms.uBuildingCenterXZ.value.copy(this.shadowGradient.buildingCenterXZ);
    if (shader.uniforms?.uBuildingHalfSizeXZ) shader.uniforms.uBuildingHalfSizeXZ.value.copy(this.shadowGradient.buildingHalfSizeXZ);
  }

  #attachEdgesToMesh(mesh, visible) {
    if (!mesh.geometry) return;
    // Не дублировать
    if (mesh.userData.__edgesAttached) return;
    const geom = new THREE.EdgesGeometry(mesh.geometry, 30); // thresholdAngle=30°
    const mat = new THREE.LineBasicMaterial({ color: 0x111111, depthTest: true });
    const lines = new THREE.LineSegments(geom, mat);
    lines.name = "edges-overlay";
    lines.renderOrder = 999;
    mesh.add(lines);
    mesh.userData.__edgesAttached = true;
    lines.visible = !!visible;
  }

  // Публичные методы управления качеством и стилем
  setEdgesVisible(visible) {
    this.edgesVisible = !!visible;
    const apply = (obj) => {
      obj.traverse?.((node) => {
        if (node.isMesh) {
          node.children?.forEach((c) => {
            if (c.name === 'edges-overlay') c.visible = !!visible;
          });
        }
      });
    };
    if (this.activeModel) apply(this.activeModel);
    if (this.demoCube) apply(this.demoCube);
  }

  setFlatShading(enabled) {
    this.flatShading = !!enabled;
    const apply = (obj) => {
      obj.traverse?.((node) => {
        if (node.isMesh) this.#applyPolygonOffsetToMesh(node, this.flatShading);
      });
    };
    if (this.activeModel) apply(this.activeModel);
    if (this.demoCube) apply(this.demoCube);
  }

  setQuality(preset) {
    this.quality = preset; // 'low' | 'medium' | 'high'
    // Настройки рендера
    if (preset === 'low') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = !!this.shadowsEnabled;
      this.controls.enableDamping = false;
    } else if (preset === 'high') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = !!this.shadowsEnabled;
      this.controls.enableDamping = true;
    } else {
      // medium
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = !!this.shadowsEnabled;
      this.controls.enableDamping = true;
    }
  }

  /**
   * Режим "Realtime-quality": применяет рекомендованные настройки рендера/постпроцесса
   * и может восстановить прежние, когда режим выключают.
   * @param {boolean} enabled
   */
  setRealtimeQualityEnabled(enabled) {
    const next = !!enabled;
    if (next === this._rtQuality.enabled) return;

    if (next) {
      // Снимок состояния для восстановления
      this._rtQuality.snapshot = {
        quality: this.quality,
        shadowsEnabled: this.shadowsEnabled,
        shadowOpacity: this.shadowStyle.opacity,
        shadowSoftness: this.shadowStyle.softness,
        sunEnabled: !!(this.sunLight && this.sunLight.visible),
        sunHeight: this.sunLight ? this.sunLight.position.y : null,
        visual: JSON.parse(JSON.stringify(this.visual)),
        materialStyle: { ...this.materialStyle },
        renderer: this.renderer ? {
          physicallyCorrectLights: this.renderer.physicallyCorrectLights,
          useLegacyLights: this.renderer.useLegacyLights,
        } : null,
      };

      // Рекомендованный пресет (баланс "красиво" / "стабильно")
      this.setQuality('high');
      this.setSunEnabled(true);
      this.setShadowsEnabled(true);
      this.setShadowSoftness(2.0);
      this.setShadowOpacity(0.18);

      // Материалы: убираем "металлические" блики, делаем архитектурно-матовый вид
      this.setMaterialPreset('matte');
      this.setMaterialRoughness(0.92);
      this.setMaterialMetalness(0.0);

      // Окружение: оставляем, но значительно слабее (иначе даёт резкие блики на фасаде)
      this.setEnvironmentEnabled(true);
      this.setEnvironmentIntensity(0.55);

      this.setToneMappingEnabled(true);
      this.setExposure(1.0);

      this.setAOEnabled(true);
      // AO чуть мягче, чтобы не давал "грязь"/мыло на расстоянии
      this.setAOIntensity(0.45);
      this.setAORadius(10);

      // Цветокор — обычно спорная, выключаем в пресете
      this.setColorCorrectionEnabled(false);
      this.setColorHue(0.0);
      this.setColorSaturation(0.0);
      this.setColorBrightness(0.0);
      this.setColorContrast(0.0);

      // Физически корректный свет (если доступно в этой версии three)
      if (this.renderer) {
        try { this.renderer.physicallyCorrectLights = true; } catch (_) {}
        try { this.renderer.useLegacyLights = false; } catch (_) {}
      }

      this._rtQuality.enabled = true;
      return;
    }

    // Выключаем: восстанавливаем снимок
    const snap = this._rtQuality.snapshot;
    this._rtQuality.enabled = false;
    this._rtQuality.snapshot = null;
    if (!snap) return;

    // Порядок важен: сначала базовые тумблеры, потом параметры
    this.setQuality(snap.quality || 'medium');
    this.setSunEnabled(!!snap.sunEnabled);
    if (typeof snap.sunHeight === 'number') this.setSunHeight(snap.sunHeight);

    this.setShadowsEnabled(!!snap.shadowsEnabled);
    if (typeof snap.shadowSoftness === 'number') this.setShadowSoftness(snap.shadowSoftness);
    if (typeof snap.shadowOpacity === 'number') this.setShadowOpacity(snap.shadowOpacity);

    // Визуал
    try {
      // environment
      this.setEnvironmentEnabled(!!snap.visual?.environment?.enabled);
      if (typeof snap.visual?.environment?.intensity === 'number') this.setEnvironmentIntensity(snap.visual.environment.intensity);
      // tone
      this.setToneMappingEnabled(!!snap.visual?.tone?.enabled);
      if (typeof snap.visual?.tone?.exposure === 'number') this.setExposure(snap.visual.tone.exposure);
      // AO
      this.setAOEnabled(!!snap.visual?.ao?.enabled);
      if (typeof snap.visual?.ao?.intensity === 'number') this.setAOIntensity(snap.visual.ao.intensity);
      if (typeof snap.visual?.ao?.radius === 'number') this.setAORadius(snap.visual.ao.radius);
      // color
      this.setColorCorrectionEnabled(!!snap.visual?.color?.enabled);
      if (typeof snap.visual?.color?.hue === 'number') this.setColorHue(snap.visual.color.hue);
      if (typeof snap.visual?.color?.saturation === 'number') this.setColorSaturation(snap.visual.color.saturation);
      if (typeof snap.visual?.color?.brightness === 'number') this.setColorBrightness(snap.visual.color.brightness);
      if (typeof snap.visual?.color?.contrast === 'number') this.setColorContrast(snap.visual.color.contrast);
    } catch (_) {}

    // Материалы (если пользователь успел переключить пресет до включения)
    try {
      if (snap.materialStyle?.preset) this.setMaterialPreset(snap.materialStyle.preset);
      this.setMaterialRoughness(snap.materialStyle?.roughness ?? null);
      this.setMaterialMetalness(snap.materialStyle?.metalness ?? null);
    } catch (_) {}

    // Рендерер флаги света
    if (this.renderer && snap.renderer) {
      try { this.renderer.physicallyCorrectLights = snap.renderer.physicallyCorrectLights; } catch (_) {}
      try { this.renderer.useLegacyLights = snap.renderer.useLegacyLights; } catch (_) {}
    }
  }

  /**
   * Включить/выключить тени.
   * Управляет shadowMap, castShadow/receiveShadow и видимостью приёмника.
   * @param {boolean} enabled
   */
  setShadowsEnabled(enabled) {
    const next = !!enabled;
    this.shadowsEnabled = next;

    if (this.renderer) {
      this.renderer.shadowMap.enabled = next;
    }
    if (this.sunLight) {
      this.sunLight.castShadow = next;
      this.sunLight.shadow.radius = this.shadowStyle.softness;
    }
    if (this.shadowReceiver) {
      this.shadowReceiver.visible = next;
      this.shadowReceiver.receiveShadow = next;
      // Прозрачность тени на земле
      if (this.shadowReceiver.material && 'opacity' in this.shadowReceiver.material) {
        this.shadowReceiver.material.opacity = this.shadowStyle.opacity;
        this.shadowReceiver.material.needsUpdate = true;
      }
    }
    this.#applyShadowGradientUniforms();
    if (this.activeModel) {
      this.activeModel.traverse?.((node) => {
        if (!node?.isMesh) return;
        node.castShadow = next;
        // Самозатенение: в тест-пресете ИЛИ при активном сечении
        node.receiveShadow = this.#getModelReceiveShadowEnabled();
      });
    }
    // Если тени переключили — синхронизируем shadow-pass клиппинга
    this.#applyClipShadowsToModelMaterials();
  }

  /**
   * Пресет "Тест": полностью изолированная настройка теней/визуала из рекомендаций.
   * При включении: переопределяет renderer/sun/AO/tone/env/materialPreset и включает самозатенение модели.
   * При выключении: восстанавливает предыдущее состояние.
   * @param {boolean} enabled
   */
  setTestPresetEnabled(enabled) {
    const next = !!enabled;
    if (next === this._testPreset.enabled) return;

    if (next) {
      // Снимок состояния для восстановления (минимально необходимое для независимости теста)
      this._testPreset.snapshot = {
        quality: this.quality,
        edgesVisible: this.edgesVisible,
        flatShading: this.flatShading,
        shadowsEnabled: this.shadowsEnabled,
        shadowOpacity: this.shadowStyle.opacity,
        shadowSoftness: this.shadowStyle.softness,
        shadowGradient: {
          enabled: this.shadowGradient.enabled,
          length: this.shadowGradient.length,
          strength: this.shadowGradient.strength,
          curve: this.shadowGradient.curve,
        },
        sun: this.sunLight ? {
          visible: this.sunLight.visible,
          intensity: this.sunLight.intensity,
          position: this.sunLight.position.clone(),
          castShadow: this.sunLight.castShadow,
          shadow: {
            mapSize: this.sunLight.shadow?.mapSize?.clone?.() || null,
            bias: this.sunLight.shadow?.bias ?? null,
            normalBias: this.sunLight.shadow?.normalBias ?? null,
            radius: this.sunLight.shadow?.radius ?? null,
            camera: this.sunLight.shadow?.camera ? {
              left: this.sunLight.shadow.camera.left,
              right: this.sunLight.shadow.camera.right,
              top: this.sunLight.shadow.camera.top,
              bottom: this.sunLight.shadow.camera.bottom,
              near: this.sunLight.shadow.camera.near,
              far: this.sunLight.shadow.camera.far,
            } : null,
          },
        } : null,
        ambient: this.ambientLight ? {
          visible: this.ambientLight.visible,
          intensity: this.ambientLight.intensity,
        } : null,
        visual: JSON.parse(JSON.stringify(this.visual)),
        materialStyle: { ...this.materialStyle },
        renderer: this.renderer ? {
          shadowMapEnabled: this.renderer.shadowMap?.enabled,
          shadowMapType: this.renderer.shadowMap?.type,
          outputEncoding: this.renderer.outputEncoding,
          outputColorSpace: this.renderer.outputColorSpace,
          toneMapping: this.renderer.toneMapping,
          toneMappingExposure: this.renderer.toneMappingExposure,
          physicallyCorrectLights: this.renderer.physicallyCorrectLights,
          useLegacyLights: this.renderer.useLegacyLights,
        } : null,
      };

      this._testPreset.enabled = true;

      // Применяем "Тест" (из рекомендаций)
      this.#applyTestPresetToScene();
      this.dumpTestPresetDebug();
      return;
    }

    // Выключаем: восстановление
    const snap = this._testPreset.snapshot;
    this._testPreset.enabled = false;
    this._testPreset.snapshot = null;
    if (!snap) return;

    // Порядок восстановления важен: базовые флаги → рендерер → свет → тени/модель → визуал
    try { this.setQuality(snap.quality || 'medium'); } catch (_) {}
    try { this.setEdgesVisible(!!snap.edgesVisible); } catch (_) {}
    try { this.setFlatShading(!!snap.flatShading); } catch (_) {}

    // renderer
    if (this.renderer && snap.renderer) {
      try { this.renderer.shadowMap.enabled = !!snap.renderer.shadowMapEnabled; } catch (_) {}
      try { if (snap.renderer.shadowMapType != null) this.renderer.shadowMap.type = snap.renderer.shadowMapType; } catch (_) {}
      try { if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = snap.renderer.outputColorSpace; } catch (_) {}
      try { if ('outputEncoding' in this.renderer) this.renderer.outputEncoding = snap.renderer.outputEncoding; } catch (_) {}
      try { this.renderer.toneMapping = snap.renderer.toneMapping; } catch (_) {}
      try { this.renderer.toneMappingExposure = snap.renderer.toneMappingExposure; } catch (_) {}
      try { this.renderer.physicallyCorrectLights = snap.renderer.physicallyCorrectLights; } catch (_) {}
      try { this.renderer.useLegacyLights = snap.renderer.useLegacyLights; } catch (_) {}
    }

    // visual (env/tone/ao/color) — через публичные сеттеры
    try {
      this.setEnvironmentEnabled(!!snap.visual?.environment?.enabled);
      this.setEnvironmentIntensity(snap.visual?.environment?.intensity ?? 1.0);
      this.setToneMappingEnabled(!!snap.visual?.tone?.enabled);
      this.setExposure(snap.visual?.tone?.exposure ?? 1.0);
      this.setAOEnabled(!!snap.visual?.ao?.enabled);
      this.setAOIntensity(snap.visual?.ao?.intensity ?? 0.75);
      this.setAORadius(snap.visual?.ao?.radius ?? 12);
      this.setColorCorrectionEnabled(!!snap.visual?.color?.enabled);
      this.setColorHue(snap.visual?.color?.hue ?? 0.0);
      this.setColorSaturation(snap.visual?.color?.saturation ?? 0.0);
      this.setColorBrightness(snap.visual?.color?.brightness ?? 0.0);
      this.setColorContrast(snap.visual?.color?.contrast ?? 0.0);
    } catch (_) {}

    // materials: вернём как было
    try {
      if (snap.materialStyle?.preset) this.setMaterialPreset(snap.materialStyle.preset);
      this.setMaterialRoughness(snap.materialStyle?.roughness ?? null);
      this.setMaterialMetalness(snap.materialStyle?.metalness ?? null);
    } catch (_) {}

    // sun/ambient
    if (this.sunLight && snap.sun) {
      try { this.sunLight.visible = !!snap.sun.visible; } catch (_) {}
      try { this.sunLight.intensity = snap.sun.intensity; } catch (_) {}
      try { this.sunLight.position.copy(snap.sun.position); } catch (_) {}
      try { this._sunBaseXZ = { x: this.sunLight.position.x, z: this.sunLight.position.z }; } catch (_) {}
      try { this.sunLight.castShadow = !!snap.sun.castShadow; } catch (_) {}
      try {
        if (snap.sun.shadow?.mapSize && this.sunLight.shadow?.mapSize) this.sunLight.shadow.mapSize.copy(snap.sun.shadow.mapSize);
        if (snap.sun.shadow?.bias != null) this.sunLight.shadow.bias = snap.sun.shadow.bias;
        if (snap.sun.shadow?.normalBias != null) this.sunLight.shadow.normalBias = snap.sun.shadow.normalBias;
        if (snap.sun.shadow?.radius != null) this.sunLight.shadow.radius = snap.sun.shadow.radius;
        if (snap.sun.shadow?.camera && this.sunLight.shadow?.camera) {
          const c = snap.sun.shadow.camera;
          this.sunLight.shadow.camera.left = c.left;
          this.sunLight.shadow.camera.right = c.right;
          this.sunLight.shadow.camera.top = c.top;
          this.sunLight.shadow.camera.bottom = c.bottom;
          this.sunLight.shadow.camera.near = c.near;
          this.sunLight.shadow.camera.far = c.far;
          this.sunLight.shadow.camera.updateProjectionMatrix();
        }
      } catch (_) {}
    }
    if (this.ambientLight && snap.ambient) {
      try { this.ambientLight.visible = !!snap.ambient.visible; } catch (_) {}
      try { this.ambientLight.intensity = snap.ambient.intensity; } catch (_) {}
    }

    // shadows & receiver style
    try {
      this.setShadowOpacity(snap.shadowOpacity);
      this.setShadowSoftness(snap.shadowSoftness);
      this.setShadowGradientEnabled(!!snap.shadowGradient?.enabled);
      this.setShadowGradientLength(snap.shadowGradient?.length ?? this.shadowGradient.length);
      this.setShadowGradientStrength(snap.shadowGradient?.strength ?? this.shadowGradient.strength);
      this.setShadowGradientCurve(snap.shadowGradient?.curve ?? this.shadowGradient.curve);
      this.setShadowsEnabled(!!snap.shadowsEnabled);
    } catch (_) {}

    // Восстановим самозатенение как было до теста (по текущей логике viewer: receiveShadow=false)
    if (this.activeModel) {
      this.activeModel.traverse?.((node) => {
        if (!node?.isMesh) return;
        node.castShadow = !!this.shadowsEnabled;
        node.receiveShadow = this.#getModelReceiveShadowEnabled();
      });
    }
    this.#applyClipShadowsToModelMaterials();
  }

  #getModelReceiveShadowEnabled() {
    // Самозатенение нужно для корректного освещения при сечении (видны комнаты внутри).
    return !!this.shadowsEnabled && (this._sectionClippingActive || !!this._testPreset?.enabled);
  }

  #getClipShadowsEnabled() {
    // Чтобы внешняя тень менялась при движении сечения, клиппинг должен участвовать в shadow-pass.
    return !!this.shadowsEnabled && !!this._sectionClippingActive;
  }

  #applyClipShadowsToModelMaterials() {
    const model = this.activeModel || this.demoCube;
    if (!model) return;
    const enabled = this.#getClipShadowsEnabled();
    const touched = new Set();
    // ВАЖНО: НЕ использовать renderer.clippingPlanes (там каждый кадр создаётся новый массив).
    // Для shadow-pass материал должен держать актуальный список активных плоскостей.
    const activePlanes = enabled
      ? (this.clipping?.planes || []).filter((p) => p && isFinite(p.constant))
      : null;
    model.traverse?.((node) => {
      if (!node?.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (!m || touched.has(m)) continue;
        touched.add(m);
        try {
          // Важно: для shadow-pass надёжнее использовать LOCAL clipping (material.clippingPlanes) + clipShadows.
          // Иначе часть сборок three может не применять global renderer.clippingPlanes к shadow map.
          if ('clippingPlanes' in m) m.clippingPlanes = activePlanes;
          if ('clipShadows' in m) m.clipShadows = enabled;
          // Тени “среза” и внутренняя отрисовка часто требуют double-side (в IFC нормали бывают проблемные).
          if (enabled && 'side' in m && m.side !== THREE.DoubleSide) m.side = THREE.DoubleSide;
          m.needsUpdate = true; // пересобрать шейдеры (включая depth/shadow варианты)
        } catch (_) {}
      }
    });
  }

  #applySectionMaterialPolicy() {
    // При активном сечении переводим неосвещаемые материалы в MeshStandardMaterial,
    // чтобы внутри появились свет/тени. При выключении — возвращаем оригиналы.
    const model = this.activeModel || this.demoCube;
    if (!model) return;

    if (!this._sectionClippingActive) {
      model.traverse?.((node) => {
        if (!node?.isMesh) return;
        const orig = this._sectionOriginalMaterial.get(node);
        if (orig) node.material = orig;
      });
      return;
    }

    model.traverse?.((node) => {
      if (!node?.isMesh) return;
      const cur = node.material;
      if (!cur) return;
      // Трогаем только "неосвещаемые" материалы (они не показывают тени на стенах).
      const arr = Array.isArray(cur) ? cur : [cur];
      const hasBasic = arr.some((m) => !!m?.isMeshBasicMaterial);
      if (!hasBasic) return;

      if (!this._sectionOriginalMaterial.has(node)) {
        this._sectionOriginalMaterial.set(node, cur);
      }

      const convert = (m) => {
        if (!m?.isMeshBasicMaterial) return m;
        const cm = this.#getConvertedMaterial(m); // -> MeshStandardMaterial с сохранением color/map/alpha
        // Делаем "архитектурный" вид по умолчанию: матовый, без металла
        try { if ('roughness' in cm) cm.roughness = 0.9; } catch (_) {}
        try { if ('metalness' in cm) cm.metalness = 0.0; } catch (_) {}
        try { cm.needsUpdate = true; } catch (_) {}
        return cm;
      };

      node.material = Array.isArray(cur) ? cur.map(convert) : convert(cur);
    });
  }

  #syncSectionClippingState() {
    const active = this.clipping?.planes?.some((p) => p && isFinite(p.constant));
    const next = !!active;
    if (next === this._sectionClippingActive) return;
    this._sectionClippingActive = next;

    // Важно: никаких глобальных усилений света/яркости на само включение сечения.
    // Подсветка делается локально и только когда камера "внутри".
    try { this.#updateInteriorAssist(true); } catch (_) {}

    // 1) self-shadowing (комнаты/стены)
    if (this.activeModel) {
      this.activeModel.traverse?.((node) => {
        if (!node?.isMesh) return;
        try { node.receiveShadow = this.#getModelReceiveShadowEnabled(); } catch (_) {}
      });
    }

    // 1.5) materials: ensure they react to light/shadows when section is active
    this.#applySectionMaterialPolicy();

    // 2) clipping in shadow pass (крыша перестаёт участвовать в тени)
    this.#applyClipShadowsToModelMaterials();

    // 3) форсируем апдейт теней
    try { if (this.sunLight?.shadow) this.sunLight.shadow.needsUpdate = true; } catch (_) {}
    try { if (this.renderer?.shadowMap) this.renderer.shadowMap.needsUpdate = true; } catch (_) {}
  }

  #ensureInteriorAssistLight() {
    if (!this.scene) return;
    if (this._interiorAssist.light) return;
    try {
      // Небольшой "fill light" около камеры. Без теней, чтобы не ломать внешнюю тень.
      const light = new THREE.PointLight(0xffffff, 0.9, 6.5, 2.0);
      light.castShadow = false;
      light.visible = false;
      light.name = 'interior-assist-light';
      this.scene.add(light);
      this._interiorAssist.light = light;
    } catch (_) {
      this._interiorAssist.light = null;
    }
  }

  #isCameraInsideModelBox() {
    const model = this.activeModel;
    if (!model || !this.camera) return false;
    const now = performance?.now?.() ?? Date.now();
    // Обновляем bbox не чаще ~4 раза/сек (достаточно; модель обычно статична)
    if (!this._interiorAssist.box || (now - (this._interiorAssist.lastBoxAt || 0)) > 250) {
      try {
        this._interiorAssist.box = new THREE.Box3().setFromObject(model);
        this._interiorAssist.lastBoxAt = now;
      } catch (_) {
        this._interiorAssist.box = null;
      }
    }
    const box = this._interiorAssist.box;
    if (!box) return false;
    const p = this.camera.position;
    const eps = 0.05;
    return (
      p.x > (box.min.x + eps) && p.x < (box.max.x - eps) &&
      p.y > (box.min.y + eps) && p.y < (box.max.y - eps) &&
      p.z > (box.min.z + eps) && p.z < (box.max.z - eps)
    );
  }

  #updateInteriorAssist(force = false) {
    if (!this._sectionClippingActive) {
      if (this._interiorAssist.enabled || force) {
        this._interiorAssist.enabled = false;
        if (this._interiorAssist.light) this._interiorAssist.light.visible = false;
        this.#restoreInteriorPost();
      }
      return;
    }

    this.#ensureInteriorAssistLight();
    const inside = this.#isCameraInsideModelBox();
    if (inside !== this._interiorAssist.enabled || force) {
      this._interiorAssist.enabled = inside;
      if (this._interiorAssist.light) this._interiorAssist.light.visible = inside;
      if (inside) this.#applyInteriorPost();
      else this.#restoreInteriorPost();
    }
    // Следуем за камерой, если активны
    if (inside && this._interiorAssist.light) {
      try { this._interiorAssist.light.position.copy(this.camera.position); } catch (_) {}
    }
  }

  #applyInteriorPost() {
    // AO OFF + лёгкий контраст только "внутри"
    if (!this._interiorPost.snapshot) {
      this._interiorPost.snapshot = {
        ao: { ...this.visual.ao },
        color: { ...this.visual.color },
      };
    }
    try { this.setAOEnabled(false); } catch (_) {}
    try {
      this.setColorCorrectionEnabled(true);
      this.setColorContrast(this._interiorPost.contrast);
      // brightness не трогаем, чтобы не пересвечивать
    } catch (_) {}
  }

  #restoreInteriorPost() {
    const snap = this._interiorPost.snapshot;
    if (!snap) return;
    try {
      this.setAOEnabled(!!snap.ao?.enabled);
      if (typeof snap.ao?.intensity === 'number') this.setAOIntensity(snap.ao.intensity);
      if (typeof snap.ao?.radius === 'number') this.setAORadius(snap.ao.radius);
      if (typeof snap.ao?.minDistance === 'number') this.visual.ao.minDistance = snap.ao.minDistance;
      if (typeof snap.ao?.maxDistance === 'number') this.visual.ao.maxDistance = snap.ao.maxDistance;
      if (this._ssaoPass) {
        this._ssaoPass.minDistance = this.visual.ao.minDistance;
        this._ssaoPass.maxDistance = this.visual.ao.maxDistance;
      }
    } catch (_) {}
    try {
      this.setColorCorrectionEnabled(!!snap.color?.enabled);
      if (typeof snap.color?.hue === 'number') this.setColorHue(snap.color.hue);
      if (typeof snap.color?.saturation === 'number') this.setColorSaturation(snap.color.saturation);
      if (typeof snap.color?.brightness === 'number') this.setColorBrightness(snap.color.brightness);
      if (typeof snap.color?.contrast === 'number') this.setColorContrast(snap.color.contrast);
    } catch (_) {}
    this._interiorPost.snapshot = null;
  }

  /**
   * Дамп текущих параметров тест-пресета в консоль.
   */
  dumpTestPresetDebug() {
    if (!this._testPreset?.enabled) return;
    const r = this.renderer;
    const sun = this.sunLight;
    const cam = sun?.shadow?.camera;
    const model = this.activeModel;
    const receiver = this.shadowReceiver;
    let meshCount = 0;
    let castOn = 0;
    let recvOn = 0;
    const matTypes = new Map();
    const sampleMats = [];
    model?.traverse?.((n) => {
      if (!n?.isMesh) return;
      meshCount++;
      if (n.castShadow) castOn++;
      if (n.receiveShadow) recvOn++;
      // Материалы: статистика по типам
      const m = n.material;
      const arr = Array.isArray(m) ? m : [m];
      for (const mi of arr) {
        if (!mi) continue;
        const t = mi.type || 'UnknownMaterial';
        matTypes.set(t, (matTypes.get(t) || 0) + 1);
        // Возьмём несколько первых материалов как сэмпл (для свойств, которые могут влиять на тени)
        if (sampleMats.length < 6) sampleMats.push(mi);
      }
    });

    // Геометрия/габариты модели (bbox)
    let bbox = null;
    try {
      if (model) {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        bbox = {
          min: { x: box.min.x, y: box.min.y, z: box.min.z },
          max: { x: box.max.x, y: box.max.y, z: box.max.z },
          size: { x: size.x, y: size.y, z: size.z },
          center: { x: center.x, y: center.y, z: center.z },
        };
      }
    } catch (_) {
      bbox = null;
    }

    // Наличие shadow map (может появиться только после первого рендера)
    const getShadowMapInfo = () => {
      try {
        const map = sun?.shadow?.map;
        const tex = map?.texture;
        const img = tex?.image;
        return {
          hasMap: !!map,
          type: map?.type || null,
          tex: tex ? { format: tex.format, type: tex.type, colorSpace: tex.colorSpace } : null,
          image: img ? { width: img.width, height: img.height } : null,
        };
      } catch (_) {
        return { hasMap: false };
      }
    };

    const getShadowReceiverInfo = () => {
      try {
        if (!receiver) return null;
        const mat = receiver.material;
        return {
          visible: !!receiver.visible,
          receiveShadow: !!receiver.receiveShadow,
          position: { x: receiver.position.x, y: receiver.position.y, z: receiver.position.z },
          scale: { x: receiver.scale.x, y: receiver.scale.y, z: receiver.scale.z },
          material: mat ? { type: mat.type, opacity: mat.opacity } : null,
        };
      } catch (_) {
        return null;
      }
    };

    const getSunTargetInfo = () => {
      try {
        const t = sun?.target;
        if (!t) return null;
        return {
          inScene: !!t.parent,
          position: { x: t.position.x, y: t.position.y, z: t.position.z },
        };
      } catch (_) {
        return null;
      }
    };

    // eslint-disable-next-line no-console
    console.groupCollapsed('[Viewer][TestPreset] dump');
    // eslint-disable-next-line no-console
    console.log('renderer.shadowMap', { enabled: r?.shadowMap?.enabled, type: r?.shadowMap?.type });
    // eslint-disable-next-line no-console
    console.log('renderer.color', { outputColorSpace: r?.outputColorSpace, outputEncoding: r?.outputEncoding, toneMapping: r?.toneMapping, exposure: r?.toneMappingExposure });
    // eslint-disable-next-line no-console
    console.log('sun', {
      intensity: sun?.intensity,
      position: sun ? { x: sun.position.x, y: sun.position.y, z: sun.position.z } : null,
      mapSize: sun?.shadow?.mapSize ? { x: sun.shadow.mapSize.x, y: sun.shadow.mapSize.y } : null,
      bias: sun?.shadow?.bias,
      normalBias: sun?.shadow?.normalBias,
      radius: sun?.shadow?.radius,
    });
    // eslint-disable-next-line no-console
    console.log('sun.target', getSunTargetInfo());
    // eslint-disable-next-line no-console
    console.log('sun.shadow.camera', cam ? { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far } : null);
    // eslint-disable-next-line no-console
    console.log('sun.shadow.map (now)', getShadowMapInfo());
    // eslint-disable-next-line no-console
    console.log('modelMeshes', { meshCount, castOn, recvOn });
    // eslint-disable-next-line no-console
    console.log('model.bbox', bbox);
    // eslint-disable-next-line no-console
    console.log('shadowReceiver', getShadowReceiverInfo());
    // eslint-disable-next-line no-console
    console.log('materials.types', Object.fromEntries(matTypes.entries()));
    // eslint-disable-next-line no-console
    console.log('materials.sample', sampleMats.map((m) => ({
      type: m?.type,
      transparent: !!m?.transparent,
      opacity: (m && 'opacity' in m) ? m.opacity : undefined,
      depthWrite: (m && 'depthWrite' in m) ? m.depthWrite : undefined,
      depthTest: (m && 'depthTest' in m) ? m.depthTest : undefined,
      side: (m && 'side' in m) ? m.side : undefined,
      color: m?.color ? `#${m.color.getHexString?.()}` : undefined,
    })));
    // eslint-disable-next-line no-console
    console.log('visual', { environment: this.visual.environment, tone: this.visual.tone, ao: this.visual.ao });
    // eslint-disable-next-line no-console
    console.log('renderer.info', r?.info ? { memory: r.info.memory, programs: r.info.programs?.length } : null);
    // eslint-disable-next-line no-console
    console.groupEnd();

    // Post-frame: проверим, появилась ли shadow map после реального рендера
    // (без повторов — логируем только при активном тесте)
    try {
      requestAnimationFrame(() => {
        if (!this._testPreset?.enabled) return;
        // eslint-disable-next-line no-console
        console.groupCollapsed('[Viewer][TestPreset] post-frame shadow map');
        // eslint-disable-next-line no-console
        console.log('sun.shadow.map (raf1)', getShadowMapInfo());
        // eslint-disable-next-line no-console
        console.groupEnd();
        requestAnimationFrame(() => {
          if (!this._testPreset?.enabled) return;
          // eslint-disable-next-line no-console
          console.groupCollapsed('[Viewer][TestPreset] post-frame shadow map (raf2)');
          // eslint-disable-next-line no-console
          console.log('sun.shadow.map (raf2)', getShadowMapInfo());
          // eslint-disable-next-line no-console
          console.groupEnd();
        });
      });
    } catch (_) {}
  }

  #applyTestPresetToScene() {
    if (!this.renderer || !this.scene) return;

    // 1) Renderer shadows
    try { this.renderer.shadowMap.enabled = true; } catch (_) {}
    try { this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; } catch (_) {}

    // 2) Tone mapping (ACES + sRGB)
    try {
      if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
    } catch (_) {}
    try { this.renderer.toneMapping = THREE.ACESFilmicToneMapping; } catch (_) {}
    try { this.renderer.toneMappingExposure = 1.0; } catch (_) {}

    // 3) Visual from recommendations
    try { this.setEnvironmentEnabled(true); } catch (_) {}
    try { this.setEnvironmentIntensity(0.65); } catch (_) {}
    try { this.setToneMappingEnabled(true); } catch (_) {}
    try { this.setExposure(1.0); } catch (_) {}
    try { this.setAOEnabled(true); } catch (_) {}
    try { this.setAOIntensity(0.52); } catch (_) {}
    try { this.setAORadius(8); } catch (_) {}
    // Цветокор не упоминался — выключаем, чтобы не влиял
    try { this.setColorCorrectionEnabled(false); } catch (_) {}

    // 4) Materials: рекомендации не требуют — фиксируем "original", чтобы исключить влияние панели
    try {
      this.setMaterialPreset('original');
      this.setMaterialRoughness(null);
      this.setMaterialMetalness(null);
    } catch (_) {}

    // 5) Edges/flat shading: фиксируем, чтобы исключить влияние панели
    try { this.setEdgesVisible(false); } catch (_) {}
    try { this.setFlatShading(false); } catch (_) {}

    // 6) Shadows: включаем и задаём параметры как в рекомендациях
    try { this.setShadowGradientEnabled(false); } catch (_) {}
    try { this.setShadowOpacity(0.30); } catch (_) {}
    try { this.setShadowSoftness(2.0); } catch (_) {}
    try { this.setShadowsEnabled(true); } catch (_) {}

    // 7) Lights: directional + ambient (как в примере)
    if (this.ambientLight) {
      this.ambientLight.visible = true;
      this.ambientLight.intensity = 0.4;
    }
    if (this.sunLight) {
      this.sunLight.visible = true;
      this.sunLight.intensity = 1.0;
      this.sunLight.castShadow = true;
      // mapSize: форсируем пересоздание shadow map (иначе WebGLRenderTarget может остаться старого размера)
      try { this.sunLight.shadow.mapSize.set(4096, 4096); } catch (_) {}
      try {
        if (this.sunLight.shadow?.map) {
          this.sunLight.shadow.map.dispose?.();
          this.sunLight.shadow.map = null;
        }
      } catch (_) {}
      try { this.sunLight.shadow.needsUpdate = true; } catch (_) {}
      try { this.sunLight.shadow.bias = -0.0001; } catch (_) {}
      try { this.sunLight.shadow.normalBias = 0.02; } catch (_) {}

      // Подгоняем shadow-camera под размер модели (если есть), иначе используем дефолтные рамки
      const model = this.activeModel;
      if (model) {
        try {
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);

          // Важно: DirectionalLight использует target для ориентации. Добавляем target в сцену и целимся в центр модели.
          try {
            if (this.sunLight.target && !this.sunLight.target.parent) {
              this.scene.add(this.sunLight.target);
            }
            this.sunLight.target.position.copy(center);
            this.sunLight.target.updateMatrixWorld?.();
          } catch (_) {}

          // Позиция солнца: фиксированное направление, масштаб по размеру модели
          const sunOffset = new THREE.Vector3(1, 2, 1).normalize().multiplyScalar(Math.max(10, maxDim * 1.5));
          const sunPos = center.clone().add(sunOffset);
          this.sunLight.position.copy(sunPos);
          this._sunBaseXZ = { x: this.sunLight.position.x, z: this.sunLight.position.z };
          try { this.sunLight.updateMatrixWorld?.(); } catch (_) {}

          const cam = this.sunLight.shadow.camera;
          cam.near = 0.5;
          cam.far = Math.max(500, maxDim * 10);
          cam.left = -maxDim;
          cam.right = maxDim;
          cam.top = maxDim;
          cam.bottom = -maxDim;
          cam.updateProjectionMatrix();
          try { this.sunLight.shadow.needsUpdate = true; } catch (_) {}
        } catch (_) {}
      } else {
        try {
          const cam = this.sunLight.shadow.camera;
          cam.near = 0.5;
          cam.far = 500;
          cam.left = -100;
          cam.right = 100;
          cam.top = 100;
          cam.bottom = -100;
          cam.updateProjectionMatrix();
          try { this.sunLight.shadow.needsUpdate = true; } catch (_) {}
        } catch (_) {}
      }
    }

    // 8) Самозатенение: все меши модели cast+receive
    if (this.activeModel) {
      this.activeModel.traverse?.((node) => {
        if (!node?.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
      });
    }
    // Приёмник теней на земле оставляем (ShadowMaterial), но без градиента
    if (this.shadowReceiver) {
      try { this.shadowReceiver.visible = true; } catch (_) {}
      try { this.shadowReceiver.receiveShadow = true; } catch (_) {}
      try {
        if (this.shadowReceiver.material && 'opacity' in this.shadowReceiver.material) {
          this.shadowReceiver.material.opacity = this.shadowStyle.opacity;
          this.shadowReceiver.material.needsUpdate = true;
        }
      } catch (_) {}
    }
  }

  /**
   * Прозрачность тени на земле (0..1).
   * Это opacity у ShadowMaterial приёмника.
   * @param {number} opacity
   */
  setShadowOpacity(opacity) {
    const v = Number(opacity);
    if (!Number.isFinite(v)) return;
    this.shadowStyle.opacity = Math.min(1, Math.max(0, v));
    if (this.shadowReceiver?.material && 'opacity' in this.shadowReceiver.material) {
      this.shadowReceiver.material.opacity = this.shadowStyle.opacity;
      this.shadowReceiver.material.needsUpdate = true;
    }
  }

  /**
   * Мягкость края тени (radius для PCFSoftShadowMap).
   * @param {number} softness
   */
  setShadowSoftness(softness) {
    const v = Number(softness);
    if (!Number.isFinite(v)) return;
    this.shadowStyle.softness = Math.max(0, v);
    if (this.sunLight) {
      this.sunLight.shadow.radius = this.shadowStyle.softness;
    }
  }

  // ===================== Materials =====================
  /**
   * Установить пресет материалов для модели.
   * @param {'original'|'matte'|'glossy'|'plastic'|'concrete'} preset
   */
  setMaterialPreset(preset) {
    const allowed = new Set(['original', 'matte', 'glossy', 'plastic', 'concrete']);
    const next = allowed.has(preset) ? preset : 'original';
    this.materialStyle.preset = next;
    // При смене пресета сбрасываем ручные override-ы (чтобы пресет был предсказуемым)
    this.materialStyle.roughness = null;
    this.materialStyle.metalness = null;
    this.#applyMaterialStyleToModel(this.activeModel);
  }

  // ===================== Visual diagnostics (Environment / Tone / AO) =====================
  setEnvironmentEnabled(enabled) {
    const next = !!enabled;
    this.visual.environment.enabled = next;
    if (next) this.#ensureEnvironment();
    if (this.scene) this.scene.environment = next ? this._roomEnvTex : null;
    this.#applyEnvIntensityToModel(this.activeModel);
  }

  setEnvironmentIntensity(intensity) {
    const v = Number(intensity);
    if (!Number.isFinite(v)) return;
    this.visual.environment.intensity = Math.min(5, Math.max(0, v));
    this.#applyEnvIntensityToModel(this.activeModel);
  }

  setToneMappingEnabled(enabled) {
    const next = !!enabled;
    this.visual.tone.enabled = next;
    this.#applyToneSettings();
  }

  setExposure(exposure) {
    const v = Number(exposure);
    if (!Number.isFinite(v)) return;
    this.visual.tone.exposure = Math.min(3.0, Math.max(0.1, v));
    this.#applyToneSettings();
  }

  /**
   * Шаг 2: включает/выключает холодное освещение (HemisphereLight + холодный AmbientLight),
   * сохраняя и восстанавливая исходные параметры.
   * @param {boolean} enabled
   */
  setCoolLightingEnabled(enabled) {
    const next = !!enabled;
    if (next === this._coolLighting.enabled) return;

    if (next) {
      // Снимем снапшот, чтобы можно было восстановить
      this._coolLighting.snapshot = {
        ambient: this.ambientLight ? {
          visible: this.ambientLight.visible,
          intensity: this.ambientLight.intensity,
          color: this.ambientLight.color?.clone?.() || null,
        } : null,
        hemi: this.hemiLight ? {
          existed: true,
          visible: this.hemiLight.visible,
          intensity: this.hemiLight.intensity,
          color: this.hemiLight.color?.clone?.() || null,
          groundColor: this.hemiLight.groundColor?.clone?.() || null,
        } : { existed: false },
        shadowReceiverColor: (this.shadowReceiver?.material?.color?.clone?.() || null),
      };

      // 1) Ambient: холодный общий
      if (this.ambientLight) {
        try { this.ambientLight.visible = true; } catch (_) {}
        try { this.ambientLight.color?.setHex?.(0xd0e0f0); } catch (_) {}
        try { this.ambientLight.intensity = 0.4; } catch (_) {}
      }

      // 2) Hemisphere: добавляем/включаем
      if (!this.hemiLight && this.scene) {
        try {
          const hemi = new THREE.HemisphereLight(0xc0d8f0, 0x444444, 0.6);
          this.scene.add(hemi);
          this.hemiLight = hemi;
        } catch (_) {}
      }
      if (this.hemiLight) {
        try { this.hemiLight.visible = true; } catch (_) {}
        try { this.hemiLight.color?.setHex?.(0xc0d8f0); } catch (_) {}
        try { this.hemiLight.groundColor?.setHex?.(0x444444); } catch (_) {}
        try { this.hemiLight.intensity = 0.6; } catch (_) {}
      }

      this._coolLighting.enabled = true;
      // Применим текущие параметры (hue/amount)
      try { this.#applyCoolLightingParams(); } catch (_) {}
      // Подкрасим тень на земле тем же холодным оттенком
      try { this.#applyShadowTintFromCoolLighting(); } catch (_) {}
      return;
    }

    // Выключение: восстановление
    const snap = this._coolLighting.snapshot;
    this._coolLighting.enabled = false;
    this._coolLighting.snapshot = null;
    if (!snap) return;

    // Ambient restore
    if (this.ambientLight && snap.ambient) {
      try { this.ambientLight.visible = !!snap.ambient.visible; } catch (_) {}
      try { if (snap.ambient.color) this.ambientLight.color.copy(snap.ambient.color); } catch (_) {}
      try { this.ambientLight.intensity = snap.ambient.intensity; } catch (_) {}
    }

    // Hemisphere restore / dispose if created by us
    if (snap.hemi?.existed) {
      // Был — вернём параметры
      if (this.hemiLight) {
        try { this.hemiLight.visible = !!snap.hemi.visible; } catch (_) {}
        try { if (snap.hemi.color) this.hemiLight.color.copy(snap.hemi.color); } catch (_) {}
        try { if (snap.hemi.groundColor) this.hemiLight.groundColor.copy(snap.hemi.groundColor); } catch (_) {}
        try { this.hemiLight.intensity = snap.hemi.intensity; } catch (_) {}
      }
    } else {
      // Не было — удалим созданный
      if (this.hemiLight && this.scene) {
        try { this.scene.remove(this.hemiLight); } catch (_) {}
        try { this.hemiLight.dispose?.(); } catch (_) {}
      }
      this.hemiLight = null;
    }

    // Shadow receiver color restore
    if (this.shadowReceiver?.material?.color) {
      try {
        if (snap.shadowReceiverColor) this.shadowReceiver.material.color.copy(snap.shadowReceiverColor);
        else this.shadowReceiver.material.color.copy(this._shadowReceiverBaseColor);
        this.shadowReceiver.material.needsUpdate = true;
      } catch (_) {}
    }
  }

  /**
   * Оттенок "холодного" цвета (hue в градусах). Рекомендуемый диапазон: 190..240.
   * @param {number} hueDeg
   */
  setCoolLightingHue(hueDeg) {
    const v = Number(hueDeg);
    if (!Number.isFinite(v)) return;
    // Разрешим шире, но UI ограничивает "холодным" диапазоном
    this._coolLighting.params.hueDeg = Math.round(Math.min(360, Math.max(0, v)));
    this.#applyCoolLightingParams();
  }

  /**
   * "Сколько синего добавить" (0..1). Это не экспозиция — влияет только на оттенок (смешивание базового и холодного).
   * @param {number} amount
   */
  setCoolLightingAmount(amount) {
    const v = Number(amount);
    if (!Number.isFinite(v)) return;
    this._coolLighting.params.amount = Math.min(1, Math.max(0, v));
    this.#applyCoolLightingParams();
  }

  #applyCoolLightingParams() {
    if (!this._coolLighting?.enabled) return;
    const snap = this._coolLighting.snapshot;
    if (!snap) return;

    const hue = (this._coolLighting.params?.hueDeg ?? 210) / 360;
    const amount = this._coolLighting.params?.amount ?? 1.0;

    // Целевой "холодный" цвет: светлый, с небольшим насыщением, но с регулируемым hue
    const target = new THREE.Color().setHSL(hue, 0.22, 0.88);

    // Ambient: смешиваем исходный цвет с target
    if (this.ambientLight && snap.ambient?.color) {
      try {
        const base = snap.ambient.color.clone();
        this.ambientLight.color.copy(base.lerp(target, amount));
      } catch (_) {}
    }

    // Hemisphere sky: смешиваем исходный цвет с target, ground оставляем как есть
    if (this.hemiLight && snap.hemi?.color) {
      try {
        const base = snap.hemi.color.clone();
        this.hemiLight.color.copy(base.lerp(target, amount));
      } catch (_) {}
    }

    // Тень на земле: подмешиваем тот же холодный оттенок
    try { this.#applyShadowTintFromCoolLighting(); } catch (_) {}
  }

  /**
   * Подкрашивает тень на "земле" (ShadowMaterial приёмника) в холодный оттенок по параметрам Шага 2.
   * Это НЕ меняет самозатенение на модели — только цвет плоскости-приёмника.
   */
  #applyShadowTintFromCoolLighting() {
    if (!this._coolLighting?.enabled) return;
    const receiver = this.shadowReceiver;
    const mat = receiver?.material;
    if (!receiver || !mat || !mat.color) return;

    const amount = this._coolLighting.params?.amount ?? 1.0;

    // Базовый цвет: нейтрально-серый (или снапшот, если приёмник существовал до включения шага)
    const base = (this._coolLighting.snapshot?.shadowReceiverColor?.clone?.() || this._shadowReceiverBaseColor.clone());
    // Целевой "холодный" цвет для тени (фиксируем для визуального подбора): #386fa4
    const target = new THREE.Color('#386fa4');
    // Amount из Шага 2 напрямую управляет подмешиванием (0..1)
    const t = Math.min(1, Math.max(0, amount));

    try {
      mat.color.copy(base.lerp(target, t));
      mat.needsUpdate = true;
    } catch (_) {}
  }

  /**
   * Шаг 3: включает/выключает фон сцены (scene.background) и восстанавливает предыдущее значение.
   * @param {boolean} enabled
   */
  setStep3BackgroundEnabled(enabled) {
    // По требованиям: фон ВСЕГДА белый (за счёт контейнера), и шаг 3 не должен менять фон сцены.
    // Поэтому игнорируем "включение" и удерживаем background прозрачным.
    if (!this.scene) return;
    this._step3Background.enabled = false;
    this._step3Background.snapshot = null;
    try { this.scene.background = null; } catch (_) {}
  }

  setAOEnabled(enabled) {
    const next = !!enabled;
    this.visual.ao.enabled = next;
    if (next) this.#ensureComposer();
    if (this._ssaoPass) this._ssaoPass.enabled = next;
  }

  // ===== Color correction =====
  setColorCorrectionEnabled(enabled) {
    const next = !!enabled;
    this.visual.color.enabled = next;
    if (next) this.#ensureComposer();
    if (this._hueSatPass) this._hueSatPass.enabled = next;
    if (this._bcPass) this._bcPass.enabled = next;
    this.#applyColorCorrectionUniforms();
  }

  setColorHue(hue) {
    const v = Number(hue);
    if (!Number.isFinite(v)) return;
    this.visual.color.hue = Math.min(1, Math.max(-1, v));
    this.#applyColorCorrectionUniforms();
  }

  setColorSaturation(sat) {
    const v = Number(sat);
    if (!Number.isFinite(v)) return;
    this.visual.color.saturation = Math.min(1, Math.max(-1, v));
    this.#applyColorCorrectionUniforms();
  }

  setColorBrightness(brightness) {
    const v = Number(brightness);
    if (!Number.isFinite(v)) return;
    this.visual.color.brightness = Math.min(1, Math.max(-1, v));
    this.#applyColorCorrectionUniforms();
  }

  setColorContrast(contrast) {
    const v = Number(contrast);
    if (!Number.isFinite(v)) return;
    this.visual.color.contrast = Math.min(1, Math.max(-1, v));
    this.#applyColorCorrectionUniforms();
  }

  // ===== Шаг 4: финальная постобработка (контраст/насыщенность) =====
  setStep4Enabled(enabled) {
    const next = !!enabled;
    this._step4.enabled = next;
    if (next) this.#ensureComposer();
    if (this._step4Pass) this._step4Pass.enabled = next;
    this.#applyStep4Uniforms();
  }

  setStep4Saturation(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    // 1.0 = без изменений, <1.0 = менее насыщенно, >1.0 = более насыщенно
    this._step4.saturation = Math.min(3.0, Math.max(0.0, v));
    this.#applyStep4Uniforms();
  }

  setStep4Contrast(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    // 1.0 = без изменений, <1.0 = ниже контраст, >1.0 = выше контраст
    this._step4.contrast = Math.min(3.0, Math.max(0.0, v));
    this.#applyStep4Uniforms();
  }

  #applyStep4Uniforms() {
    if (!this._step4Pass?.uniforms) return;
    if (this._step4Pass.uniforms.saturation) this._step4Pass.uniforms.saturation.value = this._step4.saturation ?? 1.0;
    if (this._step4Pass.uniforms.contrast) this._step4Pass.uniforms.contrast.value = this._step4.contrast ?? 1.0;
  }

  #applyColorCorrectionUniforms() {
    if (this._hueSatPass?.uniforms) {
      this._hueSatPass.uniforms.hue.value = this.visual.color.hue ?? 0.0;
      this._hueSatPass.uniforms.saturation.value = this.visual.color.saturation ?? 0.0;
    }
    if (this._bcPass?.uniforms) {
      this._bcPass.uniforms.brightness.value = this.visual.color.brightness ?? 0.0;
      this._bcPass.uniforms.contrast.value = this.visual.color.contrast ?? 0.0;
    }
  }

  setAOIntensity(intensity) {
    const v = Number(intensity);
    if (!Number.isFinite(v)) return;
    this.visual.ao.intensity = Math.min(2, Math.max(0, v));
    if (this._ssaoPass) this._ssaoPass.intensity = this.visual.ao.intensity;
  }

  setAORadius(radius) {
    const v = Number(radius);
    if (!Number.isFinite(v)) return;
    this.visual.ao.radius = Math.min(64, Math.max(1, Math.round(v)));
    if (this._ssaoPass) this._ssaoPass.kernelRadius = this.visual.ao.radius;
  }

  dumpVisualDebug() {
    const r = this.renderer;
    const s = this.scene;
    const model = this.activeModel;
    const mats = new Map();
    const flags = { totalMeshes: 0, totalMaterials: 0, withMap: 0, withNormalMap: 0, withRoughnessMap: 0, withMetalnessMap: 0 };

    model?.traverse?.((node) => {
      if (!node?.isMesh) return;
      flags.totalMeshes++;
      const m = node.material;
      const arr = Array.isArray(m) ? m : [m];
      for (const mi of arr) {
        if (!mi) continue;
        flags.totalMaterials++;
        const key = mi.type || 'UnknownMaterial';
        mats.set(key, (mats.get(key) || 0) + 1);
        if (mi.map) flags.withMap++;
        if (mi.normalMap) flags.withNormalMap++;
        if (mi.roughnessMap) flags.withRoughnessMap++;
        if (mi.metalnessMap) flags.withMetalnessMap++;
      }
    });

    // eslint-disable-next-line no-console
    console.groupCollapsed('[Viewer] Visual dump');
    // eslint-disable-next-line no-console
    console.log('three', THREE.REVISION);
    // eslint-disable-next-line no-console
    console.log('renderer', {
      outputEncoding: r?.outputEncoding,
      outputColorSpace: r?.outputColorSpace,
      toneMapping: r?.toneMapping,
      toneMappingExposure: r?.toneMappingExposure,
      physicallyCorrectLights: r?.physicallyCorrectLights,
      useLegacyLights: r?.useLegacyLights,
    });
    // eslint-disable-next-line no-console
    console.log('scene', { environment: !!s?.environment, background: !!s?.background });
    // eslint-disable-next-line no-console
    console.log('toggles', {
      env: this.visual.environment,
      tone: this.visual.tone,
      ao: this.visual.ao,
      materialPreset: this.materialStyle?.preset,
    });
    // eslint-disable-next-line no-console
    console.log('model', flags);
    // eslint-disable-next-line no-console
    console.table(Object.fromEntries(mats.entries()));
    // eslint-disable-next-line no-console
    console.groupEnd();
  }

  #ensureEnvironment() {
    if (!this.renderer || !this.scene) return;
    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(this.renderer);
    if (this._roomEnvTex) return;
    try {
      const env = new RoomEnvironment();
      const rt = this._pmrem.fromScene(env, 0.04);
      this._roomEnvTex = rt.texture;
      env.dispose?.();
    } catch (_) {
      this._roomEnvTex = null;
    }
  }

  #applyEnvIntensityToModel(model) {
    if (!model) return;
    const intensity = this.visual?.environment?.intensity ?? 1.0;
    model.traverse?.((node) => {
      if (!node?.isMesh) return;
      const m = node.material;
      const arr = Array.isArray(m) ? m : [m];
      for (const mi of arr) {
        if (!mi) continue;
        if ('envMapIntensity' in mi) mi.envMapIntensity = intensity;
      }
    });
  }

  #applyToneSettings() {
    if (!this.renderer || !this._baselineRenderer) return;
    const enabled = !!this.visual?.tone?.enabled;
    if (enabled) {
      // sRGB output
      if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
        try { this.renderer.outputColorSpace = THREE.SRGBColorSpace; } catch (_) {}
      } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding) {
        this.renderer.outputEncoding = THREE.sRGBEncoding;
      }
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = this.visual.tone.exposure ?? 1.0;
    } else {
      // restore baseline
      if ('outputColorSpace' in this.renderer) {
        try { this.renderer.outputColorSpace = this._baselineRenderer.outputColorSpace; } catch (_) {}
      }
      if ('outputEncoding' in this.renderer) {
        this.renderer.outputEncoding = this._baselineRenderer.outputEncoding;
      }
      this.renderer.toneMapping = this._baselineRenderer.toneMapping;
      this.renderer.toneMappingExposure = this._baselineRenderer.toneMappingExposure;
    }
  }

  #ensureComposer() {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this._composer) return;
    const { width, height } = this._getContainerSize();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    // Нужен stencil buffer в render targets композера для "cap" сечения
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: true });
    this._composer = new EffectComposer(this.renderer, rt);
    this._renderPass = new RenderPass(this.scene, this.camera);
    this._composer.addPass(this._renderPass);
    this._ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
    this._ssaoPass.enabled = !!this.visual?.ao?.enabled;
    this._ssaoPass.intensity = this.visual.ao.intensity;
    this._ssaoPass.kernelRadius = this.visual.ao.radius;
    this._ssaoPass.minDistance = this.visual.ao.minDistance;
    this._ssaoPass.maxDistance = this.visual.ao.maxDistance;
    this._composer.addPass(this._ssaoPass);

    // Цветокоррекция (выключена по умолчанию, включается через setColorCorrectionEnabled)
    this._hueSatPass = new ShaderPass(HueSaturationShader);
    this._hueSatPass.enabled = !!this.visual?.color?.enabled;
    this._composer.addPass(this._hueSatPass);

    this._bcPass = new ShaderPass(BrightnessContrastShader);
    this._bcPass.enabled = !!this.visual?.color?.enabled;
    this._composer.addPass(this._bcPass);

    this.#applyColorCorrectionUniforms();

    // Шаг 4: финальный цветовой pass (должен применяться в самом конце конвейера)
    const step4Shader = {
      uniforms: {
        tDiffuse: { value: null },
        saturation: { value: this._step4?.saturation ?? 1.0 },
        contrast: { value: this._step4?.contrast ?? 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float saturation; // 1.0 = no change
        uniform float contrast;   // 1.0 = no change
        varying vec2 vUv;

        vec3 rgb2hsv(vec3 c) {
          vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
          float d = q.x - min(q.w, q.y);
          float e = 1.0e-10;
          return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }

        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);

          // Contrast first (pivot at 0.5), then clamp to keep values stable
          vec3 rgb = (color.rgb - 0.5) * contrast + 0.5;
          rgb = clamp(rgb, 0.0, 1.0);

          // Saturation in HSV: лучше сохраняет оттенок в тёмных тонах (например, у синеватой тени)
          vec3 hsv = rgb2hsv(rgb);
          hsv.y = clamp(hsv.y * saturation, 0.0, 1.0);
          rgb = hsv2rgb(hsv);

          color.rgb = clamp(rgb, 0.0, 1.0);
          gl_FragColor = color;
        }
      `,
    };
    this._step4Pass = new ShaderPass(step4Shader);
    this._step4Pass.enabled = !!this._step4?.enabled;
    this._composer.addPass(this._step4Pass);
    this.#applyStep4Uniforms();
    
    // Cap (закрытие сечения) — перед FXAA, чтобы сгладить край заливки
    this._sectionCapsPass = new SectionCapsPass({
      capsRenderer: this._sectionCaps,
      getScene: () => this.scene,
      getCamera: () => this.camera,
      getSubject: () => (this.activeModel || this.demoCube),
      getActivePlanes: () => (this.clipping?.planes || []),
    });
    this._composer.addPass(this._sectionCapsPass);

    // FXAA pass для устранения "лесенки" на кривых линиях (aliasing)
    this._fxaaPass = new ShaderPass(FXAAShader);
    this._fxaaPass.material.uniforms['resolution'].value.x = 1 / w;
    this._fxaaPass.material.uniforms['resolution'].value.y = 1 / h;
    this._fxaaPass.enabled = true;  // Включен всегда для сглаживания
    this._composer.addPass(this._fxaaPass);
    
    try { this._composer.setSize(w, h); } catch (_) {}
  }

  /** @param {number|null} roughness */
  setMaterialRoughness(roughness) {
    if (roughness === null) {
      this.materialStyle.roughness = null;
    } else {
      const v = Number(roughness);
      if (!Number.isFinite(v)) return;
      this.materialStyle.roughness = Math.min(1, Math.max(0, v));
    }
    this.#applyMaterialStyleToModel(this.activeModel);
  }

  /** @param {number|null} metalness */
  setMaterialMetalness(metalness) {
    if (metalness === null) {
      this.materialStyle.metalness = null;
    } else {
      const v = Number(metalness);
      if (!Number.isFinite(v)) return;
      this.materialStyle.metalness = Math.min(1, Math.max(0, v));
    }
    this.#applyMaterialStyleToModel(this.activeModel);
  }

  #getMaterialPresetDefaults(preset) {
    switch (preset) {
      case 'matte': return { roughness: 0.90, metalness: 0.00 };
      case 'glossy': return { roughness: 0.05, metalness: 0.00 };
      // Пластик не должен быть "металлом": metalness=0, roughness повыше для архитектурного вида
      case 'plastic': return { roughness: 0.65, metalness: 0.00 };
      case 'concrete': return { roughness: 0.95, metalness: 0.00 };
      default: return { roughness: null, metalness: null };
    }
  }

  #ensureMeshOriginalMaterial(mesh) {
    if (this._meshOriginalMaterial.has(mesh)) return;
    this._meshOriginalMaterial.set(mesh, mesh.material);
  }

  #restoreOriginalMaterials(model) {
    if (!model) return;
    model.traverse?.((node) => {
      if (!node?.isMesh) return;
      const orig = this._meshOriginalMaterial.get(node);
      if (orig) node.material = orig;
    });
  }

  #getConvertedMaterial(origMat) {
    if (!origMat) return origMat;
    const cached = this._origToConvertedMaterial.get(origMat);
    if (cached) return cached;

    let converted = null;
    try {
      const origOpacity = ('opacity' in origMat) ? Number(origMat.opacity ?? 1) : 1;
      const origTransparent = ('transparent' in origMat) ? !!origMat.transparent : false;
      const hasAlphaMap = ('alphaMap' in origMat) ? !!origMat.alphaMap : false;
      const hasMap = ('map' in origMat) ? !!origMat.map : false;
      const looksTransparent = origTransparent || (Number.isFinite(origOpacity) && origOpacity < 0.999) || hasAlphaMap;

      if (origMat.isMeshStandardMaterial || origMat.isMeshPhysicalMaterial) {
        converted = origMat.clone();
      } else {
        converted = new THREE.MeshStandardMaterial();
        if (origMat.color) converted.color = origMat.color.clone();
        if ('map' in origMat) converted.map = origMat.map || null;
        if ('alphaMap' in origMat) converted.alphaMap = origMat.alphaMap || null;
        if ('transparent' in origMat) converted.transparent = !!origMat.transparent;
        if ('opacity' in origMat) converted.opacity = Number(origMat.opacity ?? 1);
        if ('side' in origMat) converted.side = origMat.side;
        if ('alphaTest' in origMat) converted.alphaTest = Number(origMat.alphaTest ?? 0);
        if ('depthWrite' in origMat) converted.depthWrite = !!origMat.depthWrite;
        if ('depthTest' in origMat) converted.depthTest = !!origMat.depthTest;
      }
      // Прозрачность: стекло/окна (самый частый источник мерцания).
      // Для стабильности: transparent=true + depthWrite=false, и НЕ форсить DoubleSide без нужды.
      if (looksTransparent) {
        const op = Number.isFinite(origOpacity) ? origOpacity : 1;
        // Бывает, что материал помечен transparent, но opacity почти 1 — делаем его непрозрачным (сильный прирост стабильности).
        if (op >= 0.995 && !hasAlphaMap) {
          converted.transparent = false;
          converted.opacity = 1;
          converted.depthWrite = true;
        } else {
          converted.transparent = true;
          converted.opacity = Math.min(1, Math.max(0.02, op));
          converted.depthTest = true;
          converted.depthWrite = false;
          const origSide = ('side' in origMat) ? origMat.side : undefined;
          converted.side = (origSide === THREE.DoubleSide) ? THREE.DoubleSide : THREE.FrontSide;
        }
      } else {
        // IFC часто содержит перевёрнутые нормали/тонкие накладки.
        // Для устойчивого отображения фасадов делаем НЕпрозрачные материалы двусторонними.
        converted.side = THREE.DoubleSide;
      }

      // Чёткость текстур на расстоянии (анизотропия), если есть карты
      try {
        const maxAniso = this.renderer?.capabilities?.getMaxAnisotropy?.() || 0;
        const aniso = Math.min(8, Math.max(0, maxAniso));
        if (aniso > 1) {
          const texList = [];
          if (hasMap && converted.map) texList.push(converted.map);
          if ('roughnessMap' in converted && converted.roughnessMap) texList.push(converted.roughnessMap);
          if ('metalnessMap' in converted && converted.metalnessMap) texList.push(converted.metalnessMap);
          if ('normalMap' in converted && converted.normalMap) texList.push(converted.normalMap);
          if ('aoMap' in converted && converted.aoMap) texList.push(converted.aoMap);
          if ('alphaMap' in converted && converted.alphaMap) texList.push(converted.alphaMap);
          for (const t of texList) {
            if (!t) continue;
            t.anisotropy = Math.max(t.anisotropy || 1, aniso);
            t.needsUpdate = true;
          }
        }
      } catch (_) {}
      // Сохраняем polygonOffset (важно для edges-overlay)
      if ('polygonOffset' in origMat) converted.polygonOffset = !!origMat.polygonOffset;
      if ('polygonOffsetFactor' in origMat) converted.polygonOffsetFactor = Number(origMat.polygonOffsetFactor ?? 0);
      if ('polygonOffsetUnits' in origMat) converted.polygonOffsetUnits = Number(origMat.polygonOffsetUnits ?? 0);
      converted.needsUpdate = true;
    } catch (_) {
      converted = origMat;
    }

    this._origToConvertedMaterial.set(origMat, converted);
    return converted;
  }

  #applyMaterialStyleToModel(model) {
    if (!model) return;
    const preset = this.materialStyle.preset || 'original';
    if (preset === 'original') {
      this.#restoreOriginalMaterials(model);
      return;
    }

    const defaults = this.#getMaterialPresetDefaults(preset);
    const rough = (this.materialStyle.roughness !== null) ? this.materialStyle.roughness : defaults.roughness;
    const metal = (this.materialStyle.metalness !== null) ? this.materialStyle.metalness : defaults.metalness;
    const targetRough = (rough === null) ? 0.8 : rough;
    const targetMetal = (metal === null) ? 0.0 : metal;

    model.traverse?.((node) => {
      if (!node?.isMesh) return;
      this.#ensureMeshOriginalMaterial(node);
      const orig = this._meshOriginalMaterial.get(node);
      if (!orig) return;

      const applyToMat = (m) => {
        const cm = this.#getConvertedMaterial(m);
        if (cm?.isMeshStandardMaterial || cm?.isMeshPhysicalMaterial) {
          cm.roughness = targetRough;
          cm.metalness = targetMetal;
          cm.needsUpdate = true;
        }
        return cm;
      };

      if (Array.isArray(orig)) {
        node.material = orig.map(applyToMat);
      } else {
        node.material = applyToMat(orig);
      }
    });
  }

  /**
   * Включить/выключить градиент тени на земле.
   * @param {boolean} enabled
   */
  setShadowGradientEnabled(enabled) {
    this.shadowGradient.enabled = !!enabled;
    this.#applyShadowGradientUniforms();
  }

  /**
   * Длина градиента тени (в мировых единицах).
   * @param {number} length
   */
  setShadowGradientLength(length) {
    const v = Number(length);
    if (!Number.isFinite(v)) return;
    this.shadowGradient.length = Math.max(0.001, v);
    this.#applyShadowGradientUniforms();
  }

  /**
   * Сила градиента тени (0..1).
   * @param {number} strength
   */
  setShadowGradientStrength(strength) {
    const v = Number(strength);
    if (!Number.isFinite(v)) return;
    this.shadowGradient.strength = Math.min(1, Math.max(0, v));
    this.#applyShadowGradientUniforms();
  }

  /**
   * Кривая затухания градиента (нелинейность).
   * 1 = линейно, >1 = дольше темно у основания, <1 = быстрее убывает в начале.
   * @param {number} curve
   */
  setShadowGradientCurve(curve) {
    const v = Number(curve);
    if (!Number.isFinite(v)) return;
    this.shadowGradient.curve = Math.max(0.05, v);
    this.#applyShadowGradientUniforms();
  }

  /**
   * Включить/выключить глобальное освещение сцены ("Солнце"):
   * directional light + ambient light.
   * @param {boolean} enabled
   */
  setSunEnabled(enabled) {
    const next = !!enabled;
    if (this.sunLight) {
      this.sunLight.visible = next;
      // Если солнце выключено — тени от него бессмысленны
      this.sunLight.castShadow = next && !!this.shadowsEnabled;
    }
    if (this.ambientLight) {
      this.ambientLight.visible = next;
    }
  }

  /**
   * Регулировка высоты солнца (Y координата DirectionalLight).
   * Чем ниже солнце — тем тени длиннее.
   * @param {number} y
   */
  setSunHeight(y) {
    if (!this.sunLight) return;
    const nextY = Number.isFinite(y) ? y : this.sunLight.position.y;
    const clamped = Math.max(0, nextY);
    this.sunLight.position.set(this._sunBaseXZ.x, clamped, this._sunBaseXZ.z);
    this.sunLight.updateMatrixWorld();
    // При активных тенях обновим shadow-camera (ориентация/проекция)
    try { this.sunLight.shadow?.camera?.updateProjectionMatrix?.(); } catch (_) {}
  }

  // --- Clipping API ---
  // axis: 'x' | 'y' | 'z', enabled: boolean, distance: number (в мировых единицах)
  setSection(axis, enabled, distance = 0) {
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const plane = this.clipping.planes[idx];
    if (enabled) {
      const subject = this.activeModel || this.demoCube;
      let dist = distance;
      // Если дистанция не задана, выбираем границу bbox со стороны камеры
      if ((plane.constant === Infinity) && subject && distance === 0) {
        const box = new THREE.Box3().setFromObject(subject);
        const center = box.getCenter(new THREE.Vector3());
        const cam = this.camera.position;
        if (idx === 0) dist = (cam.x >= center.x) ? box.max.x : box.min.x;
        else if (idx === 1) dist = (cam.y >= center.y) ? box.max.y : box.min.y;
        else dist = (cam.z >= center.z) ? box.max.z : box.min.z;
      }
      // Выберем нормаль/константу так, чтобы сохранялась «внутренняя» сторона модели (d >= 0)
      let normal;
      if (idx === 0) normal = new THREE.Vector3(1, 0, 0);
      else if (idx === 1) normal = new THREE.Vector3(0, 1, 0);
      else normal = new THREE.Vector3(0, 0, 1);
      const camPos = this.camera.position;
      const subjBox = subject ? new THREE.Box3().setFromObject(subject) : null;
      const subjCenter = subjBox ? subjBox.getCenter(new THREE.Vector3()) : new THREE.Vector3();
      const camOnPositive = idx === 0 ? (camPos.x >= subjCenter.x) : idx === 1 ? (camPos.y >= subjCenter.y) : (camPos.z >= subjCenter.z);
      // Если камера на + стороне — используем нормаль в -ось и constant=+dist, иначе нормаль +ось и constant=-dist
      if (camOnPositive) {
        normal.multiplyScalar(-1);
        plane.set(normal, +dist);
      } else {
        plane.set(normal, -dist);
      }
      // Убедимся, что ни одна из вершин bbox не уходит на «отбрасываемую» сторону из-за неточности
      if (subjBox) {
        const corners = this.#getBoxCorners(subjBox);
        let minSigned = Infinity;
        for (const c of corners) {
          const s = plane.normal.dot(c) + plane.constant;
          if (s < minSigned) minSigned = s;
        }
        if (minSigned < 0 && minSigned >= -1e-3) {
          plane.constant -= (minSigned - (-1e-4)); // сдвинем чуть так, чтобы все вершины имели s >= -1e-4
        }
      }
      this.#setGizmoVisible(axis, true);
    } else {
      // Уберём влияние — отодвинем плоскость на бесконечность
      plane.constant = Infinity;
      this.#setGizmoVisible(axis, false);
    }

    // Сечение → тени/освещение
    this.#syncSectionClippingState();
  }

  // Устанавливает позицию секущей плоскости по нормализованному значению [0..1] в пределах габаритов модели
  setSectionNormalized(axis, enabled, t = 0.5) {
    const subject = this.activeModel || this.demoCube;
    if (!subject) { this.setSection(axis, enabled, 0); return; }
    const box = new THREE.Box3().setFromObject(subject);
    const size = box.getSize(new THREE.Vector3());
    const min = box.min, max = box.max;
    let distance = 0;
    if (axis === 'x') distance = min.x + (max.x - min.x) * t;
    else if (axis === 'y') distance = min.y + (max.y - min.y) * t;
    else distance = min.z + (max.z - min.z) * t;
    this.setSection(axis, enabled, distance);
  }

  #initClippingGizmos() {
    // Создаём по манипулятору на ось. Используем общие глобальные плоскости отсечения.
    const create = (axis, idx) => {
      const manip = new SectionManipulator({
        scene: this.sectionOverlayScene,
        camera: this.camera,
        controls: this.controls,
        domElement: this.renderer.domElement,
        plane: this.clipping.planes[idx],
        axis,
      });
      // Изначально скрыт
      manip.setEnabled(false);
      return manip;
    };
    this.clipping.manipulators.x = create('x', 0);
    this.clipping.manipulators.y = create('y', 1);
    this.clipping.manipulators.z = create('z', 2);
  }

  // Гарантирует, что центр модели не будет полностью отсечён плоскостью
  #ensureCenterKeptByPlane(plane, subject) {
    try {
      const center = new THREE.Box3().setFromObject(subject).getCenter(new THREE.Vector3());
      const signed = plane.normal.dot(center) + plane.constant;
      // В three.js отсекается положительная сторона (signed > 0)
      // Если центр модели на отсекаемой стороне, инвертируем плоскость.
      if (signed > 0) {
        plane.normal.multiplyScalar(-1);
        plane.constant *= -1;
      }
    } catch (_) {}
  }

  #setGizmoVisible(axis, visible) {
    const m = this.clipping.manipulators[axis];
    if (m) m.setEnabled(!!visible);
  }

  #updateClippingGizmos() {
    const subject = this.activeModel || this.demoCube;
    const mx = this.clipping.manipulators.x;
    const my = this.clipping.manipulators.y;
    const mz = this.clipping.manipulators.z;
    mx && mx.update(subject);
    my && my.update(subject);
    mz && mz.update(subject);
  }

  // резерв: помощники больше не используются
  #getBoxCorners(box) {
    const min = box.min, max = box.max;
    return [
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, max.z),
      new THREE.Vector3(max.x, max.y, max.z),
    ];
  }

  // Вернуть стартовый вид
  goHome() {
    if (!this.camera || !this.controls) return;

    // Сброс MMB-pan (viewOffset), чтобы оси/вид вернулись как при загрузке
    try { this._mmbPan?.controller?.reset?.(); } catch (_) {}

    // Камера и прицел
    this.controls.target.copy(this._home.target);
    this.camera.position.copy(this._home.cameraPos);

    // Сброс трансформа модели (ПКМ-сдвиг): вернуть как при загрузке
    try {
      const mt = this._home?.modelTransform;
      const m = this.activeModel;
      if (m && mt && mt.position && mt.quaternion && mt.scale) {
        m.position.copy(mt.position);
        m.quaternion.copy(mt.quaternion);
        m.scale.copy(mt.scale);
        m.updateMatrixWorld?.(true);
      }
    } catch (_) {}

    // Home: вернуть тень/землю/солнце в исходное положение (единое целое с моделью)
    try {
      const p = this._home?.shadowReceiverPos;
      if (this.shadowReceiver && p) {
        this.shadowReceiver.position.copy(p);
        this.shadowReceiver.updateMatrixWorld?.(true);
      }
    } catch (_) {}
    try {
      const p = this._home?.sunTargetPos;
      if (this.sunLight?.target && p) {
        this.sunLight.target.position.copy(p);
        this.sunLight.target.updateMatrixWorld?.(true);
      }
    } catch (_) {}
    try {
      const c = this._home?.shadowGradCenterXZ;
      if (this.shadowGradient?.buildingCenterXZ && c) {
        this.shadowGradient.buildingCenterXZ.copy(c);
        this.#applyShadowGradientUniforms();
      }
    } catch (_) {}
    try { if (this.sunLight) this.sunLight.shadow && (this.sunLight.shadow.needsUpdate = true); } catch (_) {}

    // Home: сбрасываем "фиксированную ось" от ПКМ
    try { if (this._rmbModelMove) this._rmbModelMove.pivotAnchor = null; } catch (_) {}

    // Визуальные настройки
    this.setEdgesVisible(this._home.edgesVisible);
    this.setFlatShading(this._home.flatShading);
    this.setQuality(this._home.quality);
    // Клиппинг
    ['x','y','z'].forEach((axis, i) => {
      const enabled = isFinite(this._home.clipEnabled[i]);
      const dist = -this._home.clipEnabled[i];
      this.setSection(axis, enabled, enabled ? dist : 0);
    });
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Home (view only): возвращает ТОЛЬКО ракурс и масштаб (камера/target/zoom),
   * не сбрасывая активные инструменты (сечения/рёбра/тени/проекция/качество и т.п.).
   */
  goHomeViewOnly() {
    if (!this.camera || !this.controls) return;

    // Сброс MMB-pan (viewOffset) — это часть "положения на экране"
    try { this._mmbPan?.controller?.reset?.(); } catch (_) {}

    const homeTarget = this._home?.target;
    const homePos = this._home?.cameraPos;
    if (!homeTarget || !homePos) return;

    // Прицел
    try { this.controls.target.copy(homeTarget); } catch (_) {}

    // Восстановление масштаба:
    // - perspective: FOV + position
    // - ortho: zoom (подбираем так, чтобы видимый halfHeight соответствовал "домашнему" перспективному кадру)
    const homeFov = (this._home?.perspFov ?? this._projection?.persp?.fov ?? 20);

    if (this.camera.isPerspectiveCamera) {
      if (Number.isFinite(homeFov) && homeFov > 1e-3 && homeFov < 179) {
        this.camera.fov = homeFov;
      }
      this.camera.position.copy(homePos);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      return;
    }

    if (this.camera.isOrthographicCamera) {
      // Ориентация/направление — как в домашнем виде (через homePos относительно target)
      const dirVec = homePos.clone().sub(homeTarget);
      let dist = dirVec.length();
      if (!(dist > 1e-6)) dist = 1.0;
      const dirN = dirVec.multiplyScalar(1 / dist);

      // Ставим камеру на ту же дистанцию/направление — для Ortho это влияет на "ракурс", но не на масштаб
      this.camera.position.copy(homeTarget.clone().add(dirN.clone().multiplyScalar(dist)));

      // Хотим, чтобы видимый halfHeight совпадал с тем, что был бы в перспективе:
      // halfVisible = dist * tan(fov/2)
      const vFov = (Number(homeFov) * Math.PI) / 180;
      const halfVisible = Math.max(0.01, dist * Math.tan(vFov / 2));

      const aspect = this._getAspect?.() || (this.camera.aspect || 1);
      let halfH = this._projection?.orthoHalfHeight || Math.abs(this.camera.top) || 10;
      halfH = Math.max(0.01, halfH);

      const minZoom = this.controls?.minZoom ?? this._projection?.minZoom ?? 0.25;
      const maxZoom = this.controls?.maxZoom ?? this._projection?.maxZoom ?? 8;

      let zoomFit = halfH / Math.max(1e-6, halfVisible);
      if (zoomFit < minZoom) {
        // Расширим фрустум так, чтобы при minZoom кадр влезал
        halfH = Math.max(halfH, halfVisible * minZoom);
        try { this._projection.orthoHalfHeight = halfH; } catch (_) {}
        try {
          this.camera.left = -halfH * aspect;
          this.camera.right = halfH * aspect;
          this.camera.top = halfH;
          this.camera.bottom = -halfH;
        } catch (_) {}
        zoomFit = halfH / Math.max(1e-6, halfVisible);
      }

      const zoom = Math.min(maxZoom, zoomFit);
      this.camera.zoom = Math.max(1e-6, zoom);

      this.camera.updateProjectionMatrix();
      this.controls.update();
      return;
    }

    // На неизвестной камере просто восстановим позицию
    try { this.camera.position.copy(homePos); } catch (_) {}
    try { this.camera.updateProjectionMatrix(); } catch (_) {}
    try { this.controls.update(); } catch (_) {}
  }

  // ================= Вспомогательное: ось вращения =================
  #ensureRotationAxisLine() {
    if (this.rotationAxisLine) return this.rotationAxisLine;
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: 0x84ffff,
      dashSize: 0.06, // меньше базовый размер
      gapSize: 0.02,  // маленький промежуток
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    line.visible = false;
    line.renderOrder = 1002;
    line.name = 'rotation-axis-line';
    this.scene.add(line);
    this.rotationAxisLine = line;
    return line;
  }

  #hideRotationAxisLine() {
    if (this.rotationAxisLine) this.rotationAxisLine.visible = false;
    this._prevViewDir = null;
  }

  #updateRotationAxisLine() {
    // Визуализацию оси вращения временно отключаем:
    // логика вычисления оси и создание линии оставлены в коде,
    // но сейчас просто не показываем её, чтобы не мешала.
    return;

    if (!this.camera || !this.controls) return;
    // Порог по экранному движению
    if (this._recentPointerDelta < this._pointerPxThreshold) return;

    const currentDir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!this._prevViewDir) { this._prevViewDir = currentDir.clone(); return; }

    // Угловой порог (dead zone)
    const dot = THREE.MathUtils.clamp(this._prevViewDir.dot(currentDir), -1, 1);
    const angle = Math.acos(dot);
    if (angle < this._rotAngleEps) return;

    // Ось = prev × current
    let axis = this._prevViewDir.clone().cross(currentDir);
    const axisLen = axis.length();
    if (axisLen < 1e-6) return; // почти нет вращения
    axis.normalize();

    // Сглаживание оси (EMA)
    if (this._smoothedAxis) {
      this._smoothedAxis.lerp(axis, this._axisEmaAlpha).normalize();
    } else {
      this._smoothedAxis = axis.clone();
    }

    const subject = this.activeModel || this.demoCube;
    let sizeLen = 1.0;
    if (subject) {
      const box = new THREE.Box3().setFromObject(subject);
      const size = box.getSize(new THREE.Vector3());
      sizeLen = Math.max(size.x, size.y, size.z) * 0.7;
    }

    const line = this.#ensureRotationAxisLine();
    const target = this.controls.target.clone();
    const p1 = target.clone().add(this._smoothedAxis.clone().multiplyScalar(sizeLen));
    const p2 = target.clone().add(this._smoothedAxis.clone().multiplyScalar(-sizeLen));
    line.geometry.setFromPoints([p1, p2]);
    line.computeLineDistances();
    const mat = line.material;
    if (mat && 'dashSize' in mat) {
      // ~в 3 раза мельче штрихи и с очень маленьким промежутком
      mat.dashSize = sizeLen * 0.026;
      mat.gapSize = sizeLen * 0.010;
      mat.needsUpdate = true;
    }
    line.visible = true;

    // Обновим предыдущее направление и сбросим экранный сдвиг
    this._prevViewDir = currentDir.clone();
    this._recentPointerDelta = 0;
  }
}


