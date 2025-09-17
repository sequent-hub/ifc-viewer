// Класс Viewer инкапсулирует настройку three.js сцены
// Чистый JS, без фреймворков. Комментарии на русском.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
    this.edgesVisible = true;
    this.flatShading = true;
    this.quality = 'medium'; // low | medium | high
    this.navCube = null;
    this.sectionOverlayScene = null;
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

    this.handleResize = this.handleResize.bind(this);
    this.animate = this.animate.bind(this);
  }

  init() {
    if (!this.container) throw new Error("Viewer: контейнер не найден");

    // Рендерер
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false; // управляем очисткой вручную для мульти-проходов
    // Спрячем канвас до первого корректного измерения
    this.renderer.domElement.style.visibility = "hidden";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.container.appendChild(this.renderer.domElement);

    // Сцена
    this.scene = new THREE.Scene();
    // Оверлей-сцена для секущих манипуляторов (без клиппинга)
    this.sectionOverlayScene = new THREE.Scene();

    // Камера
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const aspect = width / height;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(0, 2, 3);
    this.camera.lookAt(0, 0, 0);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 1;
    this.controls.maxDistance = 20;

    // Свет
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 5, 5);
    this.scene.add(dir);

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
    });

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
      this.renderer.render(this.scene, this.camera);
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

    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
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

    // Расширим дальнюю плоскость, чтобы исключить клиппинг при большом отъезде
    const desiredFar = Math.max(this.camera.far, newMax * 4);
    if (desiredFar !== this.camera.far) {
      this.camera.far = desiredFar;
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

    // Подчеркнуть грани: полигон оффсет + контуры
    object3D.traverse?.((node) => {
      if (node.isMesh) {
        this.#applyPolygonOffsetToMesh(node, this.flatShading);
        this.#attachEdgesToMesh(node, this.edgesVisible);
      }
    });
    // Настроим пределы зума и сфокусируемся на новой модели
    this.applyAdaptiveZoomLimits(object3D, { padding: 1.2, slack: 2.5, minRatio: 0.05, recenter: true });
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
      this.renderer.shadowMap.enabled = false;
      this.controls.enableDamping = false;
    } else if (preset === 'high') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = false;
      this.controls.enableDamping = true;
    } else {
      // medium
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = false;
      this.controls.enableDamping = true;
    }
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
}


