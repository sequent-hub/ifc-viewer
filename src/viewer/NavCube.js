// Класс NavCube — интерактивный навигационный куб в правом верхнем углу
// Без внешних зависимостей. Рендерится во второй проход в тот же WebGLRenderer.

import * as THREE from "three";

export class NavCube {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.PerspectiveCamera} mainCamera
   * @param {any} controls OrbitControls (ожидается target, update())
   * @param {HTMLElement} container контейнер, содержащий канвас
   * @param {{ sizePx?: number, marginPx?: number, opacity?: number, onHome?: () => void }} [opts]
   */
  constructor(renderer, mainCamera, controls, container, opts = {}) {
    this.renderer = renderer;
    this.mainCamera = mainCamera;
    this.controls = controls;
    this.container = container;

    this.sizePx = opts.sizePx ?? 96;
    this.marginPx = opts.marginPx ?? 10;
    this.faceOpacity = opts.opacity ?? 0.6;
    this.onHome = typeof opts.onHome === 'function' ? opts.onHome : null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    // Полупрозрачный куб с окрашенными сторонами (+X/-X, +Y/-Y, +Z/-Z)
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mats = [
      new THREE.MeshBasicMaterial({ color: 0xd32f2f, transparent: true, opacity: this.faceOpacity }), // +X (red)
      new THREE.MeshBasicMaterial({ color: 0x7f0000, transparent: true, opacity: this.faceOpacity }), // -X (dark red)
      new THREE.MeshBasicMaterial({ color: 0x388e3c, transparent: true, opacity: this.faceOpacity }), // +Y (green)
      new THREE.MeshBasicMaterial({ color: 0x1b5e20, transparent: true, opacity: this.faceOpacity }), // -Y (dark green)
      new THREE.MeshBasicMaterial({ color: 0x1976d2, transparent: true, opacity: this.faceOpacity }), // +Z (blue)
      new THREE.MeshBasicMaterial({ color: 0x0d47a1, transparent: true, opacity: this.faceOpacity }), // -Z (dark blue)
    ];
    this.cube = new THREE.Mesh(geom, mats);
    this.cube.name = "nav-cube";
    this.scene.add(this.cube);

    // Увеличим куб в 1.5 раза
    this._cubeScale = 1.5;
    this.cube.scale.setScalar(this._cubeScale);
    // Подвинем камеру, чтобы увеличенный куб целиком помещался во вьюпорте
    const vFov = (this.camera.fov * Math.PI) / 180;
    const radius = Math.sqrt(3) * 0.5 * this._cubeScale; // радиус сферы, описанной вокруг куба
    const fitDist = (radius / Math.tan(vFov / 2)) * 1.12; // небольшой запас
    this.camera.position.set(0, 0, Math.max(fitDist, this.camera.near + 0.2));
    this.camera.lookAt(0, 0, 0);

    // Рёбра для читабельности
    const edges = new THREE.EdgesGeometry(geom, 1);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x111111, depthTest: true });
    this.cubeEdges = new THREE.LineSegments(edges, lineMat);
    this.cubeEdges.renderOrder = 999;
    this.cube.add(this.cubeEdges);

    // Подписи граней (крупные, чёрные, на самих гранях)
    this.#addFaceLabels();

    // Raycaster для интерактивности
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this._isPointerInside = false;
    this._lastDownPos = null;
    this._clickTolerance = 4; // px

    // Анимация камеры до заданного направления
    this._tweenActive = false;
    this._tweenStart = 0;
    this._tweenDuration = 450; // мс
    this._startPos = new THREE.Vector3();
    this._startUp = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._targetUp = new THREE.Vector3();

    // Слушатели мыши на канвасе рендера
    this.dom = this.renderer.domElement;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this.dom.addEventListener("pointermove", this._onPointerMove, { passive: true });
    this.dom.addEventListener("pointerdown", this._onPointerDown, { passive: false });
    this.dom.addEventListener("pointerup", this._onPointerUp, { passive: false });

    // Кнопка Home слева от куба
    this.homeBtn = document.createElement('button');
    this.homeBtn.type = 'button';
    this.homeBtn.title = 'Home';
    this.homeBtn.textContent = '⌂';
    this.homeBtn.style.position = 'absolute';
    this.homeBtn.style.zIndex = '40';
    this.homeBtn.style.width = '28px';
    this.homeBtn.style.height = '28px';
    this.homeBtn.style.lineHeight = '28px';
    this.homeBtn.style.textAlign = 'center';
    this.homeBtn.style.borderRadius = '6px';
    this.homeBtn.style.border = '1px solid rgba(255,255,255,0.4)';
    this.homeBtn.style.background = 'rgba(0,0,0,0.45)';
    this.homeBtn.style.color = '#fff';
    this.homeBtn.style.cursor = 'pointer';
    this.homeBtn.style.userSelect = 'none';
    this.homeBtn.style.font = '14px/28px system-ui, sans-serif';
    // Позиция задаётся в renderOverlay относительно текущего размера
    this.homeBtn.addEventListener('click', () => { try { this.onHome && this.onHome(); } catch(_) {} });
    try { this.container.appendChild(this.homeBtn); } catch(_) {}
  }

  dispose() {
    this.dom.removeEventListener("pointermove", this._onPointerMove);
    this.dom.removeEventListener("pointerdown", this._onPointerDown);
    this.dom.removeEventListener("pointerup", this._onPointerUp);
    if (this.homeBtn && this.homeBtn.parentNode) {
      try { this.homeBtn.parentNode.removeChild(this.homeBtn); } catch(_) {}
      this.homeBtn = null;
    }
    this.scene.traverse((obj) => {
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
  }

  onResize() {
    // ничего, камера NavCube — квадратная, viewport зададим при рендере
  }

  // Рендер маленького вида в правом верхнем углу
  renderOverlay() {
    if (!this.renderer) return;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const fullW = Math.max(1, Math.floor(rect.width));
    const fullH = Math.max(1, Math.floor(rect.height));

    const vpSize = Math.min(this.sizePx, Math.min(fullW, fullH));
    const x = fullW - this.marginPx - vpSize;
    // В WebGL (и three.js) ось Y viewport-а идёт снизу вверх, поэтому для
    // «верхнего правого» угла считаем Y от нижнего края канваса
    const y = fullH - this.marginPx - vpSize;

    // Синхронизируем ориентацию куба с камерой сцены
    // Инвертируем quaternion камеры, чтобы куб отражал мировые оси корректно
    this.cube.quaternion.copy(this.mainCamera.quaternion).invert();

    // Сохраним и отключим клиппинг, чтобы куб не отсекался
    const prevLocal = this.renderer.localClippingEnabled;
    const prevPlanes = this.renderer.clippingPlanes;
    this.renderer.localClippingEnabled = false;
    this.renderer.clippingPlanes = [];

    // Включим scissor, чтобы не затрагивать основную сцену
    this.renderer.clearDepth();
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(x, y, vpSize, vpSize);
    this.renderer.setScissor(x, y, vpSize, vpSize);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    // Восстановим полный viewport на всякий случай
    this.renderer.setViewport(0, 0, fullW, fullH);

    // Восстановим клиппинг
    this.renderer.localClippingEnabled = prevLocal;
    this.renderer.clippingPlanes = prevPlanes;

    // Позиционируем кнопку Home слева от куба
    if (this.homeBtn) {
      this.homeBtn.style.top = `${this.marginPx + 2}px`;
      this.homeBtn.style.left = `${Math.max(2, fullW - this.marginPx - vpSize - 32)}px`;
    }
  }

  // ================= Подписи граней =================
  #addFaceLabels() {
    const makeFaceTexture = (text) => {
      const size = 512; // квадрат для равномерности
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.clearRect(0, 0, size, size);
      // Чёрный крупный текст по центру
      ctx.fillStyle = '#000';
      // Уменьшаем шрифт примерно в 1.2 раза относительно прошлого (0.42 -> ~0.35)
      const fontPx = Math.floor(size * 0.35);
      ctx.font = `bold ${fontPx}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text.toUpperCase(), size / 2, size / 2);
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    };

    const makeFaceLabelMesh = (text, normal) => {
      const tex = makeFaceTexture(text);
      if (!tex) return null;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
      // Уменьшаем паддинги плашки: максимально приближаем к размеру грани
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.995, 0.995), mat);
      // Ориентируем плоскость, чтобы нормаль смотрела как normal
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      plane.setRotationFromQuaternion(q);
      // Позиционируем чуть снаружи от грани
      plane.position.copy(normal.clone().multiplyScalar(0.505));
      // Компенсируем масштаб куба, чтобы размер текста остался прежним
      const s = this._cubeScale || 1;
      plane.scale.setScalar(1 / s);
      plane.renderOrder = 1001;
      return plane;
    };

    // Переназначаем подписи: слева->спереди, справа->сзади, сзади->слева, спереди->справа
    const faces = [
      { text: 'сверху', normal: new THREE.Vector3(0, 1, 0) },   // +Y
      { text: 'снизу',  normal: new THREE.Vector3(0, -1, 0) },  // -Y
      { text: 'справа', normal: new THREE.Vector3(0, 0, 1) },   // +Z (было "спереди") -> "справа"
      { text: 'слева',  normal: new THREE.Vector3(0, 0, -1) },  // -Z (было "сзади") -> "слева"
      { text: 'спереди',normal: new THREE.Vector3(-1, 0, 0) },  // -X (было "слева") -> "спереди"
      { text: 'сзади',  normal: new THREE.Vector3(1, 0, 0) },   // +X (было "справа") -> "сзади"
    ];

    faces.forEach(({ text, normal }) => {
      const mesh = makeFaceLabelMesh(text, normal);
      if (mesh) this.cube.add(mesh);
    });
  }

  // ================= Ввод мыши =================
  _isInsideOverlay(clientX, clientY) {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const fullW = Math.max(1, Math.floor(rect.width));
    const fullH = Math.max(1, Math.floor(rect.height));
    const vpSize = Math.min(this.sizePx, Math.min(fullW, fullH));
    const x = rect.left + fullW - this.marginPx - vpSize;
    const y = rect.top + this.marginPx;
    return clientX >= x && clientX <= x + vpSize && clientY >= y && clientY <= y + vpSize;
  }

  _toNdcInOverlay(clientX, clientY) {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const fullW = Math.max(1, Math.floor(rect.width));
    const fullH = Math.max(1, Math.floor(rect.height));
    const vpSize = Math.min(this.sizePx, Math.min(fullW, fullH));
    const x = rect.left + fullW - this.marginPx - vpSize;
    const y = rect.top + this.marginPx;
    // локальные координаты внутри вьюпорта
    const lx = (clientX - x) / vpSize;
    const ly = (clientY - y) / vpSize;
    // в NDC [-1,1]
    this.pointerNdc.set(lx * 2 - 1, -(ly * 2 - 1));
  }

  _onPointerMove(e) {
    this._isPointerInside = this._isInsideOverlay(e.clientX, e.clientY);
  }

  _onPointerDown(e) {
    if (!this._isInsideOverlay(e.clientX, e.clientY)) return;
    // Блокируем орбит-контролы на время клика по кубу
    e.preventDefault();
    this._lastDownPos = { x: e.clientX, y: e.clientY };
  }

  _onPointerUp(e) {
    if (!this._isInsideOverlay(e.clientX, e.clientY)) return;
    e.preventDefault();
    if (this._lastDownPos) {
      const dx = e.clientX - this._lastDownPos.x;
      const dy = e.clientY - this._lastDownPos.y;
      if (dx * dx + dy * dy <= this._clickTolerance * this._clickTolerance) {
        this._handleClick(e.clientX, e.clientY);
      }
    }
    this._lastDownPos = null;
  }

  _handleClick(clientX, clientY) {
    this._toNdcInOverlay(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersects = this.raycaster.intersectObject(this.cube, false);
    if (!intersects || intersects.length === 0) return;
    const hit = intersects[0];
    // Точка пересечения в локальных координатах куба
    const localPoint = this.cube.worldToLocal(hit.point.clone());
    const dir = this._directionFromLocalPoint(localPoint);
    this._animateCameraTo(dir);
  }

  // Определяем тип/направление по точке на поверхности куба
  _directionFromLocalPoint(p) {
    // Локальный куб размера 1: поверхность на координатах = ±0.5 по одной из осей
    const ax = Math.abs(p.x);
    const ay = Math.abs(p.y);
    const az = Math.abs(p.z);
    const sgn = (v) => (v >= 0 ? 1 : -1);

    // Какая ось зафиксирована (лицевая грань)
    let axis = 0; // 0=x, 1=y, 2=z
    let s = 1;
    if (ax >= ay && ax >= az) { axis = 0; s = sgn(p.x); }
    else if (ay >= ax && ay >= az) { axis = 1; s = sgn(p.y); }
    else { axis = 2; s = sgn(p.z); }

    // Проекционные координаты вдоль других осей для определения крайности
    const u = axis === 0 ? p.y : p.x; // первая свободная ось
    const v = axis === 2 ? p.y : p.z; // вторая свободная ось (подобрано так, чтобы покрыть все случаи)
    const au = Math.abs(u);
    const av = Math.abs(v);

    // Порог близости к ребру/углу
    const edgeThresh = 0.35; // ближе к 0.5 — ребра/углы

    let dir = new THREE.Vector3();
    if (au > edgeThresh && av > edgeThresh) {
      // Угол — сумма трёх осей
      const vx = axis === 0 ? s : sgn(p.x);
      const vy = axis === 1 ? s : sgn(p.y);
      const vz = axis === 2 ? s : sgn(p.z);
      dir.set(vx, vy, vz).normalize();
    } else if (au > edgeThresh || av > edgeThresh) {
      // Ребро — сумма двух осей
      if (axis === 0) dir.set(s, sgn(p.y), 0);
      else if (axis === 1) dir.set(sgn(p.x), s, 0);
      else dir.set(sgn(p.x), sgn(p.y), s);
      dir.normalize();
    } else {
      // Лицевая грань — единичный вектор по оси
      if (axis === 0) dir.set(s, 0, 0);
      else if (axis === 1) dir.set(0, s, 0);
      else dir.set(0, 0, s);
    }
    return dir;
  }

  // ======== Анимация камеры к новому направлению ========
  _animateCameraTo(direction) {
    if (!this.mainCamera || !this.controls) return;
    const target = this.controls.target.clone();
    const dist = this.mainCamera.position.distanceTo(target);

    const newPos = target.clone().add(direction.clone().normalize().multiplyScalar(dist));
    const newUp = Math.abs(direction.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);

    this._startPos.copy(this.mainCamera.position);
    this._startUp.copy(this.mainCamera.up);
    this._targetPos.copy(newPos);
    this._targetUp.copy(newUp);
    this._tweenStart = performance.now();
    this._tweenActive = true;

    const step = () => {
      if (!this._tweenActive) return;
      const t = (performance.now() - this._tweenStart) / this._tweenDuration;
      const k = t >= 1 ? 1 : this._easeInOutCubic(t);

      // Интерполяция позиции
      this.mainCamera.position.copy(this._startPos.clone().lerp(this._targetPos, k));
      // Интерполяция up-вектора
      const up = this._startUp.clone().lerp(this._targetUp, k).normalize();
      this.mainCamera.up.copy(up);
      this.mainCamera.lookAt(target);
      this.mainCamera.updateProjectionMatrix();
      if (this.controls) this.controls.update();

      if (t >= 1) {
        this._tweenActive = false;
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
}


