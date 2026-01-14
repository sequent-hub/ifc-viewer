import * as THREE from "three";

class CardMarker {
  /**
   * @param {object} deps
   * @param {number} deps.id
   * @param {THREE.Vector3} deps.localPoint
   * @param {HTMLElement} deps.el
   * @param {object|null} deps.sceneState
   */
  constructor(deps) {
    this.id = deps.id;
    this.localPoint = deps.localPoint;
    this.el = deps.el;
    this.sceneState = deps.sceneState || null;
  }
}

/**
 * UI-контроллер: "+ Добавить карточку" → призрак у курсора → установка метки кликом по модели.
 *
 * Важно:
 * - метка хранит координату в ЛОКАЛЬНЫХ координатах activeModel, чтобы "ехать" вместе с моделью при её перемещении.
 * - во время режима постановки блокируем обработку LMB у OrbitControls/других контроллеров (capture-phase).
 */
export class CardPlacementController {
  /**
   * @param {object} deps
   * @param {import('../viewer/Viewer.js').Viewer} deps.viewer
   * @param {HTMLElement} deps.container Контейнер viewer (обычно #app)
   * @param {object} [deps.logger]
   */
  constructor(deps) {
    this.viewer = deps.viewer;
    this.container = deps.container;
    this.logger = deps.logger || null;

    this._placing = false;
    this._nextId = 1;
    /** @type {CardMarker[]} */
    this._markers = [];

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._tmpV = new THREE.Vector3();
    this._tmpLocal = new THREE.Vector3();

    this._lastPointer = { x: 0, y: 0 };
    this._ghostPos = { x: 0, y: 0 };
    this._raf = 0;

    this._controlsWasEnabled = null;

    this._containerOffset = { left: 0, top: 0 };
    this._containerOffsetValid = false;

    this._fly = {
      raf: 0,
      active: false,
      prevControlsEnabled: null,
      startTs: 0,
      durationMs: 550,
      // start/end snapshots
      from: null,
      to: null,
      // tmp vectors
      v0: new THREE.Vector3(),
      v1: new THREE.Vector3(),
      v2: new THREE.Vector3(),
    };

    this._ui = this.#createUi();
    this.#attachUi();
    this.#bindEvents();
    this.#startRaf();
  }

  dispose() {
    try { this.cancelPlacement(); } catch (_) {}
    try { this.#cancelFly(); } catch (_) {}

    const dom = this.viewer?.renderer?.domElement;
    try { dom?.removeEventListener("pointermove", this._onPointerMove); } catch (_) {}
    try { dom?.removeEventListener("pointerrawupdate", this._onPointerRawUpdate); } catch (_) {}
    try { dom?.removeEventListener("pointerdown", this._onPointerDownCapture, { capture: true }); } catch (_) {
      try { dom?.removeEventListener("pointerdown", this._onPointerDownCapture); } catch (_) {}
    }
    try { window.removeEventListener("keydown", this._onKeyDown); } catch (_) {}
    try { window.removeEventListener("resize", this._onWindowResize); } catch (_) {}
    try { window.removeEventListener("scroll", this._onWindowScroll, true); } catch (_) {}
    try { this._ui?.btn?.removeEventListener("click", this._onBtnClick); } catch (_) {}

    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;

    try { this._markers.forEach((m) => m?.el?.remove?.()); } catch (_) {}
    this._markers.length = 0;

    try { this._ui?.ghost?.remove?.(); } catch (_) {}
    try { this._ui?.btn?.remove?.(); } catch (_) {}
  }

  startPlacement() {
    if (this._placing) return;
    this._placing = true;

    const controls = this.viewer?.controls;
    if (controls) {
      // Запоминаем и временно выключаем OrbitControls целиком
      this._controlsWasEnabled = !!controls.enabled;
      controls.enabled = false;
    }

    this.#refreshContainerOffset();
    this.#syncGhost();
    this.#setGhostVisible(true);
    this.#log("startPlacement", { nextId: this._nextId });
  }

  cancelPlacement() {
    if (!this._placing) return;
    this._placing = false;
    this.#setGhostVisible(false);

    const controls = this.viewer?.controls;
    if (controls && this._controlsWasEnabled != null) {
      controls.enabled = !!this._controlsWasEnabled;
      this._controlsWasEnabled = null;
    }

    this.#log("cancelPlacement", {});
  }

  #log(event, payload) {
    try {
      this.logger?.log?.("[CardPlacement]", event, payload);
    } catch (_) {}
  }

  #easeOutCubic(t) {
    const x = Math.min(1, Math.max(0, Number(t) || 0));
    const inv = 1 - x;
    return 1 - inv * inv * inv; // быстрый старт, плавный конец
  }

  #cancelFly() {
    if (this._fly.raf) cancelAnimationFrame(this._fly.raf);
    this._fly.raf = 0;
    this._fly.active = false;
    this._fly.startTs = 0;
    this._fly.from = null;
    this._fly.to = null;

    // Вернём OrbitControls, если отключали
    try {
      const controls = this.viewer?.controls;
      if (controls && this._fly.prevControlsEnabled != null) controls.enabled = this._fly.prevControlsEnabled;
    } catch (_) {}
    this._fly.prevControlsEnabled = null;
  }

  #getCurrentCameraSnapshot() {
    const viewer = this.viewer;
    if (!viewer) return null;
    const camera = viewer.camera;
    const controls = viewer.controls;
    if (!camera || !controls) return null;

    const snap = {
      projectionMode: (typeof viewer.getProjectionMode === "function")
        ? viewer.getProjectionMode()
        : (camera.isOrthographicCamera ? "ortho" : "perspective"),
      camPos: camera.position.clone(),
      target: controls.target.clone(),
      fov: camera.isPerspectiveCamera ? Number(camera.fov) : null,
      zoom: camera.isOrthographicCamera ? Number(camera.zoom || 1) : null,
      viewOffset: (camera.view && camera.view.enabled)
        ? { enabled: true, offsetX: camera.view.offsetX || 0, offsetY: camera.view.offsetY || 0 }
        : { enabled: false, offsetX: 0, offsetY: 0 },
    };
    return snap;
  }

  #captureSceneState() {
    const viewer = this.viewer;
    if (!viewer) return null;

    const camera = viewer.camera;
    const controls = viewer.controls;
    const model = viewer.activeModel;

    const projectionMode = (typeof viewer.getProjectionMode === "function")
      ? viewer.getProjectionMode()
      : (camera?.isOrthographicCamera ? "ortho" : "perspective");

    const camPos = camera?.position ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null;
    const target = controls?.target ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : null;

    const cam = {
      projectionMode,
      position: camPos,
      target,
      fov: (camera && camera.isPerspectiveCamera) ? Number(camera.fov) : null,
      zoom: (camera && camera.isOrthographicCamera) ? Number(camera.zoom || 1) : null,
      // MMB-pan (camera.viewOffset) — сохраняем как есть, в пикселях
      viewOffset: (camera && camera.view && camera.view.enabled)
        ? { enabled: true, offsetX: camera.view.offsetX || 0, offsetY: camera.view.offsetY || 0 }
        : { enabled: false, offsetX: 0, offsetY: 0 },
    };

    const modelTransform = model ? {
      position: { x: model.position.x, y: model.position.y, z: model.position.z },
      quaternion: { x: model.quaternion.x, y: model.quaternion.y, z: model.quaternion.z, w: model.quaternion.w },
      scale: { x: model.scale.x, y: model.scale.y, z: model.scale.z },
    } : null;

    const planes = viewer.clipping?.planes || [];
    const clipConstants = [
      planes?.[0]?.constant,
      planes?.[1]?.constant,
      planes?.[2]?.constant,
    ];

    return {
      camera: cam,
      modelTransform,
      clipping: { constants: clipConstants },
    };
  }

  #restoreSceneState(sceneState) {
    const viewer = this.viewer;
    if (!viewer || !sceneState) return;

    // 1) Проекция (может заменить ссылку viewer.camera)
    try {
      const pm = sceneState?.camera?.projectionMode;
      if (pm && typeof viewer.setProjectionMode === "function") viewer.setProjectionMode(pm);
    } catch (_) {}

    const camera = viewer.camera;
    const controls = viewer.controls;
    const model = viewer.activeModel;

    // 2) Камера + target + zoom/fov
    try {
      const t = sceneState?.camera?.target;
      if (controls && t) controls.target.set(Number(t.x) || 0, Number(t.y) || 0, Number(t.z) || 0);
    } catch (_) {}
    try {
      const p = sceneState?.camera?.position;
      if (camera && p) camera.position.set(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
    } catch (_) {}
    try {
      if (camera?.isPerspectiveCamera && sceneState?.camera?.fov != null) {
        const fov = Number(sceneState.camera.fov);
        if (Number.isFinite(fov) && fov > 1e-3 && fov < 179) camera.fov = fov;
      }
    } catch (_) {}
    try {
      if (camera?.isOrthographicCamera && sceneState?.camera?.zoom != null) {
        const z = Number(sceneState.camera.zoom);
        if (Number.isFinite(z) && z > 1e-6) camera.zoom = z;
      }
    } catch (_) {}

    // 3) Трансформ модели (позиция/поворот/масштаб)
    try {
      const mt = sceneState?.modelTransform;
      if (model && mt?.position && mt?.quaternion && mt?.scale) {
        model.position.set(Number(mt.position.x) || 0, Number(mt.position.y) || 0, Number(mt.position.z) || 0);
        model.quaternion.set(
          Number(mt.quaternion.x) || 0,
          Number(mt.quaternion.y) || 0,
          Number(mt.quaternion.z) || 0,
          Number(mt.quaternion.w) || 1
        );
        model.scale.set(Number(mt.scale.x) || 1, Number(mt.scale.y) || 1, Number(mt.scale.z) || 1);
        model.updateMatrixWorld?.(true);
      }
    } catch (_) {}

    // 4) ViewOffset (MMB-pan) — применяем после смены камеры/проекции
    try {
      const vo = sceneState?.camera?.viewOffset;
      if (camera && vo && typeof camera.setViewOffset === "function") {
        const dom = viewer?.renderer?.domElement;
        const rect = dom?.getBoundingClientRect?.();
        const w = Math.max(1, Math.floor(rect?.width || 1));
        const h = Math.max(1, Math.floor(rect?.height || 1));
        if (vo.enabled) {
          camera.setViewOffset(w, h, Math.round(Number(vo.offsetX) || 0), Math.round(Number(vo.offsetY) || 0), w, h);
        } else if (typeof camera.clearViewOffset === "function") {
          camera.clearViewOffset();
        } else {
          camera.setViewOffset(w, h, 0, 0, w, h);
        }
      }
    } catch (_) {}

    // 5) Клиппинг (как Home: сначала восстановили камеру+модель, затем planes)
    try {
      const constants = sceneState?.clipping?.constants || [];
      if (typeof viewer.setSection === "function") {
        ["x", "y", "z"].forEach((axis, i) => {
          const c = constants[i];
          const enabled = Number.isFinite(c);
          const dist = -Number(c);
          viewer.setSection(axis, enabled, enabled ? dist : 0);
        });
      }
    } catch (_) {}

    try { camera?.updateProjectionMatrix?.(); } catch (_) {}
    try { controls?.update?.(); } catch (_) {}
  }

  #applyModelTransformFromState(sceneState) {
    const viewer = this.viewer;
    if (!viewer || !sceneState) return;
    const model = viewer.activeModel;
    if (!model) return;
    const mt = sceneState?.modelTransform;
    if (!mt?.position || !mt?.quaternion || !mt?.scale) return;
    try {
      model.position.set(Number(mt.position.x) || 0, Number(mt.position.y) || 0, Number(mt.position.z) || 0);
      model.quaternion.set(
        Number(mt.quaternion.x) || 0,
        Number(mt.quaternion.y) || 0,
        Number(mt.quaternion.z) || 0,
        Number(mt.quaternion.w) || 1
      );
      model.scale.set(Number(mt.scale.x) || 1, Number(mt.scale.y) || 1, Number(mt.scale.z) || 1);
      model.updateMatrixWorld?.(true);
    } catch (_) {}
  }

  #applyClippingFromState(sceneState) {
    const viewer = this.viewer;
    if (!viewer || !sceneState) return;
    try {
      const constants = sceneState?.clipping?.constants || [];
      if (typeof viewer.setSection === "function") {
        ["x", "y", "z"].forEach((axis, i) => {
          const c = constants[i];
          const enabled = Number.isFinite(c);
          const dist = -Number(c);
          viewer.setSection(axis, enabled, enabled ? dist : 0);
        });
      }
    } catch (_) {}
  }

  #applyViewOffset(camera, viewOffset) {
    if (!camera || !viewOffset) return;
    try {
      const viewer = this.viewer;
      const dom = viewer?.renderer?.domElement;
      const rect = dom?.getBoundingClientRect?.();
      const w = Math.max(1, Math.floor(rect?.width || 1));
      const h = Math.max(1, Math.floor(rect?.height || 1));

      if (viewOffset.enabled) {
        camera.setViewOffset(w, h, Math.round(Number(viewOffset.offsetX) || 0), Math.round(Number(viewOffset.offsetY) || 0), w, h);
      } else if (typeof camera.clearViewOffset === "function") {
        camera.clearViewOffset();
      } else {
        camera.setViewOffset(w, h, 0, 0, w, h);
      }
    } catch (_) {}
  }

  #animateToSceneState(sceneState, durationMs = 550) {
    const viewer = this.viewer;
    if (!viewer || !sceneState) return;

    // Если уже летим — отменим предыдущую анимацию
    this.#cancelFly();

    // 1) Сразу применяем проекцию (может сменить viewer.camera)
    try {
      const pm = sceneState?.camera?.projectionMode;
      if (pm && typeof viewer.setProjectionMode === "function") viewer.setProjectionMode(pm);
    } catch (_) {}

    // 2) Сразу применяем трансформ модели (если нужен) — камера полетит уже к нужной сцене
    this.#applyModelTransformFromState(sceneState);

    const camera = viewer.camera;
    const controls = viewer.controls;
    if (!camera || !controls) return;

    const from = this.#getCurrentCameraSnapshot();
    if (!from) return;

    // Целевые значения (камера/target/zoom/fov/offset)
    const to = {
      projectionMode: sceneState?.camera?.projectionMode || from.projectionMode,
      camPos: sceneState?.camera?.position
        ? new THREE.Vector3(Number(sceneState.camera.position.x) || 0, Number(sceneState.camera.position.y) || 0, Number(sceneState.camera.position.z) || 0)
        : from.camPos.clone(),
      target: sceneState?.camera?.target
        ? new THREE.Vector3(Number(sceneState.camera.target.x) || 0, Number(sceneState.camera.target.y) || 0, Number(sceneState.camera.target.z) || 0)
        : from.target.clone(),
      fov: (camera.isPerspectiveCamera && sceneState?.camera?.fov != null) ? Number(sceneState.camera.fov) : from.fov,
      zoom: (camera.isOrthographicCamera && sceneState?.camera?.zoom != null) ? Number(sceneState.camera.zoom) : from.zoom,
      viewOffset: sceneState?.camera?.viewOffset || from.viewOffset,
    };

    // На время "долеталки" отключаем controls
    try {
      this._fly.prevControlsEnabled = !!controls.enabled;
      controls.enabled = false;
    } catch (_) {
      this._fly.prevControlsEnabled = null;
    }

    this._fly.active = true;
    this._fly.startTs = performance.now();
    this._fly.durationMs = Math.max(50, Number(durationMs) || 550);
    this._fly.from = from;
    this._fly.to = to;

    const tick = () => {
      if (!this._fly.active) return;
      const now = performance.now();
      const t = (now - this._fly.startTs) / this._fly.durationMs;
      const k = this.#easeOutCubic(t);

      // position lerp
      this._fly.v0.copy(from.camPos).lerp(to.camPos, k);
      camera.position.copy(this._fly.v0);

      // target lerp
      this._fly.v1.copy(from.target).lerp(to.target, k);
      controls.target.copy(this._fly.v1);

      // fov/zoom
      try {
        if (camera.isPerspectiveCamera && to.fov != null && from.fov != null) {
          const f = Number(from.fov) + (Number(to.fov) - Number(from.fov)) * k;
          if (Number.isFinite(f) && f > 1e-3 && f < 179) camera.fov = f;
        }
      } catch (_) {}
      try {
        if (camera.isOrthographicCamera && to.zoom != null && from.zoom != null) {
          const z = Number(from.zoom) + (Number(to.zoom) - Number(from.zoom)) * k;
          if (Number.isFinite(z) && z > 1e-6) camera.zoom = z;
        }
      } catch (_) {}

      // viewOffset lerp
      try {
        const vo0 = from.viewOffset || { enabled: false, offsetX: 0, offsetY: 0 };
        const vo1 = to.viewOffset || { enabled: false, offsetX: 0, offsetY: 0 };
        const enabled = !!(vo0.enabled || vo1.enabled);
        const ox = Number(vo0.offsetX) + (Number(vo1.offsetX) - Number(vo0.offsetX)) * k;
        const oy = Number(vo0.offsetY) + (Number(vo1.offsetY) - Number(vo0.offsetY)) * k;
        this.#applyViewOffset(camera, { enabled, offsetX: ox, offsetY: oy });
      } catch (_) {}

      try { camera.updateProjectionMatrix?.(); } catch (_) {}
      try { controls.update?.(); } catch (_) {}

      if (t >= 1) {
        // Финал: зафиксируем точные значения
        try { camera.position.copy(to.camPos); } catch (_) {}
        try { controls.target.copy(to.target); } catch (_) {}
        try {
          if (camera.isPerspectiveCamera && to.fov != null) camera.fov = to.fov;
          if (camera.isOrthographicCamera && to.zoom != null) camera.zoom = to.zoom;
        } catch (_) {}
        try { this.#applyViewOffset(camera, to.viewOffset); } catch (_) {}

        // В конце применяем clipping (чтобы ориентация плоскостей считалась по финальной камере)
        this.#applyClippingFromState(sceneState);

        try { camera.updateProjectionMatrix?.(); } catch (_) {}
        try { controls.update?.(); } catch (_) {}

        this.#cancelFly();
        return;
      }

      this._fly.raf = requestAnimationFrame(tick);
    };

    this._fly.raf = requestAnimationFrame(tick);
  }

  #createUi() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ifc-card-add-btn";
    btn.textContent = "+ Добавить карточку";

    const ghost = document.createElement("div");
    ghost.className = "ifc-card-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.display = "none";
    // Базовая позиция: двигаем transform'ом, поэтому left/top держим в 0
    ghost.style.left = "0px";
    ghost.style.top = "0px";

    const dot = document.createElement("div");
    dot.className = "ifc-card-dot";
    const num = document.createElement("div");
    num.className = "ifc-card-num";

    ghost.appendChild(dot);
    ghost.appendChild(num);

    return { btn, ghost, dot, num };
  }

  #attachUi() {
    // Важно: container должен быть position:relative (в index.html уже так).
    this.container.appendChild(this._ui.btn);
    this.container.appendChild(this._ui.ghost);
  }

  #bindEvents() {
    this._onBtnClick = (e) => {
      // Не даём событию уйти в canvas/OrbitControls и не ставим метку "тем же кликом".
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
      this.startPlacement();
    };
    this._ui.btn.addEventListener("click", this._onBtnClick, { passive: false });

    this._onKeyDown = (e) => {
      if (!this._placing) return;
      if (e.key === "Escape") this.cancelPlacement();
    };
    window.addEventListener("keydown", this._onKeyDown);

    // Смещение контейнера (#app) относительно viewport может меняться при resize/scroll.
    // Обновляем кэш, чтобы призрак/метки не "плыли".
    this._onWindowResize = () => {
      this.#refreshContainerOffset();
      if (this._placing) this.#syncGhost();
    };
    this._onWindowScroll = () => {
      this.#refreshContainerOffset();
      if (this._placing) this.#syncGhost();
    };
    window.addEventListener("resize", this._onWindowResize, { passive: true });
    // scroll слушаем в capture, чтобы ловить скролл вложенных контейнеров
    window.addEventListener("scroll", this._onWindowScroll, true);

    const dom = this.viewer?.renderer?.domElement;
    if (!dom) return;

    this._onPointerMove = (e) => {
      if (!this._placing) return;
      this.#updateGhostFromClient(e.clientX, e.clientY);
    };
    dom.addEventListener("pointermove", this._onPointerMove, { passive: true });

    // Best-effort: более частые координаты, чем pointermove (Chrome).
    this._onPointerRawUpdate = (e) => {
      if (!this._placing) return;
      this.#updateGhostFromClient(e.clientX, e.clientY);
    };
    try { dom.addEventListener("pointerrawupdate", this._onPointerRawUpdate, { passive: true }); } catch (_) {}

    this._onPointerDownCapture = (e) => {
      if (!this._placing) return;
      // Только ЛКМ ставит метку. Остальные кнопки не блокируем (например, колесо/ПКМ).
      if (e.button !== 0) return;

      // Блокируем другие контроллеры (OrbitControls/MMB/RMB) на время постановки.
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}

      const hit = this.#pickModelPoint(e.clientX, e.clientY);
      if (!hit) {
        this.#log("placeAttempt:no-hit", {});
        return; // остаёмся в режиме, пользователь может кликнуть ещё раз
      }
      this.#createMarkerAtHit(hit);
      this.cancelPlacement(); // по ТЗ: “вторым кликом устанавливаем”
    };
    dom.addEventListener("pointerdown", this._onPointerDownCapture, { capture: true, passive: false });
  }

  #setGhostVisible(visible) {
    if (!this._ui?.ghost) return;
    this._ui.ghost.style.display = visible ? "block" : "none";
  }

  #refreshContainerOffset() {
    const cr = this.container?.getBoundingClientRect?.();
    if (!cr) {
      this._containerOffset.left = 0;
      this._containerOffset.top = 0;
      this._containerOffsetValid = false;
      return;
    }
    this._containerOffset.left = cr.left || 0;
    this._containerOffset.top = cr.top || 0;
    this._containerOffsetValid = true;
  }

  #applyGhostTransform() {
    const g = this._ui?.ghost;
    if (!g) return;
    g.style.transform = `translate3d(${this._ghostPos.x}px, ${this._ghostPos.y}px, 0) translate(-50%, -50%)`;
  }

  #updateGhostFromClient(clientX, clientY) {
    this._lastPointer = { x: clientX, y: clientY };
    if (!this._containerOffsetValid) this.#refreshContainerOffset();
    const x = (clientX - this._containerOffset.left);
    const y = (clientY - this._containerOffset.top);
    this._ghostPos.x = x;
    this._ghostPos.y = y;
    // Обновляем transform сразу в обработчике — без ожидания RAF.
    this.#applyGhostTransform();
  }

  #syncGhost() {
    const g = this._ui?.ghost;
    if (!g) return;
    this._ui.num.textContent = String(this._nextId);
    // Число может меняться (id), позиция — из последних координат курсора.
    this.#updateGhostFromClient(this._lastPointer.x, this._lastPointer.y);
  }

  #pickModelPoint(clientX, clientY) {
    const model = this.viewer?.activeModel;
    const camera = this.viewer?.camera;
    const dom = this.viewer?.renderer?.domElement;
    if (!model || !camera || !dom) return null;

    const rect = dom.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this._ndc.set(x, y);

    this._raycaster.setFromCamera(this._ndc, camera);
    const hits = this._raycaster.intersectObject(model, true);
    if (!hits || !hits[0] || !hits[0].point) return null;

    return hits[0];
  }

  #createMarkerAtHit(hit) {
    const model = this.viewer?.activeModel;
    if (!model) return;

    const id = this._nextId++;
    const el = document.createElement("div");
    el.className = "ifc-card-marker";
    el.setAttribute("data-id", String(id));
    el.innerHTML = `<div class="ifc-card-dot"></div><div class="ifc-card-num">${id}</div>`;
    // Базовая позиция: двигаем transform'ом, поэтому left/top держим в 0
    el.style.left = "0px";
    el.style.top = "0px";
    this.container.appendChild(el);

    const sceneState = this.#captureSceneState();

    // Храним локальную координату модели, чтобы метка оставалась “приклеенной” к модели
    this._tmpLocal.copy(hit.point);
    model.worldToLocal(this._tmpLocal);

    const marker = new CardMarker({
      id,
      localPoint: this._tmpLocal.clone(),
      el,
      sceneState,
    });
    this._markers.push(marker);

    // Клик по метке: восстановить сцену (камера/зум, модель, разрез)
    this._onMarkerPointerDown = (e) => {
      // Важно: не даём клику попасть в canvas/OrbitControls
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
      // если были в режиме постановки — выходим
      try { this.cancelPlacement(); } catch (_) {}
      // "Долеталка" камеры: быстрый старт + мягкий конец
      this.#animateToSceneState(marker.sceneState, 550);
    };
    // capture-phase, чтобы обогнать любые handlers на canvas
    try { el.addEventListener("pointerdown", this._onMarkerPointerDown, { capture: true, passive: false }); } catch (_) {
      try { el.addEventListener("pointerdown", this._onMarkerPointerDown); } catch (_) {}
    }

    this.#log("placed", {
      id,
      local: { x: +marker.localPoint.x.toFixed(4), y: +marker.localPoint.y.toFixed(4), z: +marker.localPoint.z.toFixed(4) },
      sceneState: sceneState ? { hasCamera: !!sceneState.camera, hasModel: !!sceneState.modelTransform, hasClip: !!sceneState.clipping } : null,
    });
  }

  #startRaf() {
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      this.#updateMarkerScreenspace();
    };
    this._raf = requestAnimationFrame(tick);
  }

  #updateMarkerScreenspace() {
    const model = this.viewer?.activeModel;
    const camera = this.viewer?.camera;
    const dom = this.viewer?.renderer?.domElement;
    if (!camera || !dom) return;

    const rect = dom.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const w = rect.width;
    const h = rect.height;

    for (const m of this._markers) {
      if (!m || !m.el) continue;

      if (!model) {
        m.el.style.display = "none";
        continue;
      }

      // local -> world (учитывает позицию/поворот/scale модели)
      this._tmpV.copy(m.localPoint);
      model.localToWorld(this._tmpV);

      const ndc = this._tmpV.project(camera);

      // Если точка за камерой или далеко за пределами — скрываем
      const inFront = Number.isFinite(ndc.z) && ndc.z >= -1 && ndc.z <= 1;
      if (!inFront) {
        m.el.style.display = "none";
        continue;
      }

      const x = (ndc.x * 0.5 + 0.5) * w;
      const y = (-ndc.y * 0.5 + 0.5) * h;

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        m.el.style.display = "none";
        continue;
      }

      m.el.style.display = "block";
      m.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    }
  }
}

