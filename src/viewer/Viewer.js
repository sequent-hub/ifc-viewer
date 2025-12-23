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
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { NavCube } from "./NavCube.js";
import { SectionManipulator } from "./SectionManipulator.js";

export class Viewer {
  constructor(containerElement) {
    /** @type {HTMLElement} */
    this.container = containerElement;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
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
    this._baselineRenderer = null;
    this._pmrem = null;
    this._roomEnvTex = null;
    this._composer = null;
    this._renderPass = null;
    this._ssaoPass = null;
    this._hueSatPass = null;
    this._bcPass = null;
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

    // Snapshot начального состояния для Home
    this._home = {
      cameraPos: null,
      target: new THREE.Vector3(0, 0, 0),
      edgesVisible: false,
      flatShading: true,
      quality: 'medium',
      clipEnabled: [Infinity, Infinity, Infinity],
    };

    // Визуализация оси вращения
    this.rotationAxisLine = null;
    this._isLmbDown = false;
    this._wasRotating = false;
    this._prevViewDir = null;
    this._smoothedAxis = null;
    this._recentPointerDelta = 0;
    this._pointerPxThreshold = 2; // минимальный экранный сдвиг
    this._rotAngleEps = 0.01;     // ~0.57° минимальный угловой сдвиг
    this._axisEmaAlpha = 0.15;    // коэффициент сглаживания оси

    this._onPointerDown = null;
    this._onPointerUp = null;
    this._onPointerMove = null;
    this._onControlsStart = null;
    this._onControlsChange = null;
    this._onControlsEnd = null;

    this.handleResize = this.handleResize.bind(this);
    this.animate = this.animate.bind(this);
  }

  init() {
    if (!this.container) throw new Error("Viewer: контейнер не найден");

    // Рендерер
    // logarithmicDepthBuffer: уменьшает z-fighting на почти копланарных поверхностях (часто в IFC).
    // Это заметно снижает "мигание" тонких накладных деталей на фасадах.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false; // управляем очисткой вручную для мульти-проходов
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
    // Оверлей-сцена для секущих манипуляторов (без клиппинга)
    this.sectionOverlayScene = new THREE.Scene();

    // Камера
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const aspect = width / height;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(-22.03, 23.17, 39.12);
    this.camera.lookAt(0, 0, 0);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 1;
    this.controls.maxDistance = 20;

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
      onHome: () => this.goHome(),
    });

    // Визуальная ось вращения: события мыши и контролов
    this._onPointerDown = (e) => { if (e.button === 0) this._isLmbDown = true; };
    this._onPointerUp = (e) => { if (e.button === 0) { this._isLmbDown = false; this.#hideRotationAxisLine(); } };
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
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp, { passive: true });
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove, { passive: true });

    this._onControlsStart = () => {
      // Инициализируем предыдущий вектор направления вида
      if (!this.camera || !this.controls) return;
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this._prevViewDir = dir;
      this._smoothedAxis = null;
    };
    this._onControlsChange = () => {
      // Обновляем ось только при зажатой ЛКМ (вращение)
      if (!this._isLmbDown) return;
      this.#updateRotationAxisLine();
    };
    this._onControlsEnd = () => { this.#hideRotationAxisLine(); };
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
    this._home.edgesVisible = this.edgesVisible;
    this._home.flatShading = this.flatShading;
    this._home.quality = this.quality;
    this._home.clipEnabled = this.clipping.planes.map(p => p.constant);

    // Сигнал о готовности после первого кадра
    requestAnimationFrame(() => {
      this._dispatchReady();
    });
  }

  handleResize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const { width, height } = this._getContainerSize();
    this._updateSize(Math.max(1, width), Math.max(1, height));
    // Обновим пределы зума под текущий объект без переразмещения камеры
    const subject = this.activeModel || this.demoCube;
    if (subject) this.applyAdaptiveZoomLimits(subject, { recenter: false });
    // Обновим вспомогательные overlay-виджеты
    if (this.navCube) this.navCube.onResize();
  }

  animate() {
    if (this.autoRotateDemo && this.demoCube) {
      this.demoCube.rotation.y += 0.01;
      this.demoCube.rotation.x += 0.005;
    }

    if (this.controls) this.controls.update();
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
      const useComposer = !!(this._composer && (this.visual?.ao?.enabled || this.visual?.color?.enabled));
      if (useComposer) {
        this._composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
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
    const d = this.getDistance();
    const minD = this.controls.minDistance || 1;
    const maxD = this.controls.maxDistance || 20;
    const clamped = Math.min(Math.max(d, minD), maxD);
    const t = (maxD - clamped) / (maxD - minD); // 0..1
    return t * 100; // 0%..100%
  }

  zoomIn(factor = 0.9) {
    if (!this.camera || !this.controls) return;
    this.#moveAlongView(factor);
  }

  zoomOut(factor = 1.1) {
    if (!this.camera || !this.controls) return;
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
    this.controls.minDistance = newMin;
    this.controls.maxDistance = newMax;

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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Третий аргумент false — не менять стилевые размеры, только буфер
    this.renderer.setSize(width, height, false);
    if (this._composer) {
      try { this._composer.setSize(width, height); } catch (_) {}
    }
    if (this._ssaoPass?.setSize) {
      try { this._ssaoPass.setSize(width, height); } catch (_) {}
    }
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

    // Пересчитать плоскость под моделью (3x по площади bbox по X/Z)
    this.#updateShadowReceiverFromModel(object3D);

    // Подчеркнуть грани: полигон оффсет + контуры
    object3D.traverse?.((node) => {
      if (node.isMesh) {
        // Тени управляются единообразно через setShadowsEnabled()
        node.castShadow = !!this.shadowsEnabled;
        // Самозатенение включается только в пресете "Тест"
        node.receiveShadow = !!this._testPreset?.enabled;
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

    // Настроим пределы зума и сфокусируемся на новой модели
    this.applyAdaptiveZoomLimits(object3D, { padding: 1.2, slack: 2.5, minRatio: 0.05, recenter: true });

    // Если "Тест" активен, сразу применим его к только что загруженной модели (самозатенение + shadow camera по bbox)
    if (this._testPreset?.enabled) {
      try { this.#applyTestPresetToScene(); } catch (_) {}
    }

    // На следующем кадре отъедем на 2x от вписанной дистанции (точно по размеру модели)
    try {
      const box = new THREE.Box3().setFromObject(object3D);
      const center = box.getCenter(new THREE.Vector3());
      requestAnimationFrame(() => {
        if (!this.camera || !this.controls) return;
        // Центрируем точку взгляда на центр модели и ставим камеру в заданные координаты
        this.controls.target.copy(center);
        this.camera.position.set(-22.03, 23.17, 39.12);
        try {
          // Если камера слишком близко, отъедем до вписанной дистанции, сохранив направление
          const size = box.getSize(new THREE.Vector3());
          const fitDistExact = this.#computeFitDistanceForSize(size, 1.2);
          const dirVec = this.camera.position.clone().sub(center);
          const dist = dirVec.length();
          if (dist < fitDistExact && dist > 1e-6) {
            const dirNorm = dirVec.multiplyScalar(1 / dist);
            this.camera.position.copy(center.clone().add(dirNorm.multiplyScalar(fitDistExact)));
          }
          // Поднимем модель в кадре: сместим точку прицеливания немного вниз по Y
          const verticalBias = size.y * 0.30; // 30% высоты
          this.controls.target.y = center.y - verticalBias;
        } catch(_) {}
        // После ручной перестановки камеры ещё раз "оздоровим" near/far под модель,
        // чтобы не ловить z-fighting на фасадных накладках.
        try { this.applyAdaptiveZoomLimits(object3D, { padding: 1.2, slack: 2.5, minRatio: 0.05, recenter: false }); } catch (_) {}
        this.camera.updateProjectionMatrix();
        this.controls.update();

        // Снимем актуальный «домашний» вид после всех корректировок
        this._home.cameraPos = this.camera.position.clone();
        this._home.target = this.controls.target.clone();
        this._home.edgesVisible = this.edgesVisible;
        this._home.flatShading = this.flatShading;
        this._home.quality = this.quality;
        this._home.clipEnabled = this.clipping.planes.map(p => p.constant);
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
    const mat = new THREE.ShadowMaterial({ opacity: this.shadowStyle.opacity });
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

      // Требование: площадь плоскости = 3x площади объекта (bbox по X/Z).
      // => множитель по размерам = sqrt(3).
      const areaMultiplier = 3;
      const dimMul = Math.sqrt(areaMultiplier);

      this.shadowReceiver.position.set(center.x, minY + 0.001, center.z);
      this.shadowReceiver.scale.set(Math.max(0.001, size.x * dimMul), Math.max(0.001, size.z * dimMul), 1);
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
        const halfX = (size.x * dimMul) / 2;
        const halfZ = (size.z * dimMul) / 2;
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
        // Самозатенение включается только в пресете "Тест"
        node.receiveShadow = !!this._testPreset?.enabled;
      });
    }
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
        node.receiveShadow = false;
      });
    }
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
    this.visual.tone.exposure = Math.min(2.5, Math.max(0.1, v));
    this.#applyToneSettings();
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
    this._composer = new EffectComposer(this.renderer);
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
        if (minSigned < 0) {
          plane.constant -= (minSigned - (-1e-4)); // сдвинем чуть так, чтобы все вершины имели s >= -1e-4
        }
      }
      this.#setGizmoVisible(axis, true);
    } else {
      // Уберём влияние — отодвинем плоскость на бесконечность
      plane.constant = Infinity;
      this.#setGizmoVisible(axis, false);
    }
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
    // Камера и прицел
    this.controls.target.copy(this._home.target);
    this.camera.position.copy(this._home.cameraPos);
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


