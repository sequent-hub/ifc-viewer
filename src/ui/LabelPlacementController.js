import * as THREE from "three";

class LabelMarker {
  /**
   * @param {object} deps
   * @param {number|string} deps.id
   * @param {THREE.Vector3} deps.localPoint
   * @param {HTMLElement} deps.el
   * @param {object|null} deps.sceneState
   */
  constructor(deps) {
    this.id = deps.id;
    this.localPoint = deps.localPoint;
    this.el = deps.el;
    this.sceneState = deps.sceneState || null;
    this.visible = null;
    this.hiddenReason = null;
  }
}

/**
 * UI-контроллер: "+ Добавить метку" → призрак у курсора → установка метки кликом по модели.
 *
 * Важно:
 * - метка хранит координату в ЛОКАЛЬНЫХ координатах activeModel, чтобы "ехать" вместе с моделью при её перемещении.
 * - во время режима постановки блокируем обработку LMB у OrbitControls/других контроллеров (capture-phase).
 */
export class LabelPlacementController {
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
    this._visibilityLogEnabled = !!deps.visibilityLogEnabled;
    this._editingEnabled = deps?.editingEnabled !== false;

    this._placing = false;
    this._nextId = 1;
    /** @type {LabelMarker[]} */
    this._markers = [];
    this._selectedId = null;
    this._labelsHidden = false;

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._tmpV = new THREE.Vector3();
    this._tmpLocal = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpNdc = new THREE.Vector3();

    this._lastPointer = { x: 0, y: 0 };
    this._ghostPos = { x: 0, y: 0 };
    this._raf = 0;

    this._labelDrag = {
      active: false,
      moved: false,
      // true => призрак живёт в document.body и позиционируется по viewport
      ghostInBody: false,
      pointerId: null,
      id: null,
      start: { x: 0, y: 0 },
      last: { x: 0, y: 0 },
      ghostPos: { x: 0, y: 0 },
      clickMarker: null,
      prevControlsEnabled: null,
      threshold: 4,
    };

    this._labelDragDropSelector = deps?.labelDragDropSelector || null;

    this._controlsWasEnabled = null;

    this._containerOffset = { left: 0, top: 0 };
    this._containerOffsetValid = false;

    this._contextMenu = {
      open: false,
      marker: null,
    };
    this._canvasMenu = {
      open: false,
      hit: null,
    };

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

    this._autoHide = {
      active: false,
      prevHidden: false,
    };
    this._showAfterStop = {
      raf: 0,
      active: false,
      lastChangeTs: 0,
      idleMs: 0,
      eps: 5e-4,
      lastCamMatrix: new Float32Array(16),
    };

    this._ui = this.#createUi();
    this.#attachUi();
    this.#syncEditingUi();
    this.#bindEvents();
    this.#startRaf();
  }

  dispose() {
    try { this.cancelPlacement(); } catch (_) {}
    try { this.#cancelFly(); } catch (_) {}
    try { this.#closeContextMenu(); } catch (_) {}

    const dom = this.viewer?.renderer?.domElement;
    try { dom?.removeEventListener("pointermove", this._onPointerMove); } catch (_) {}
    try { dom?.removeEventListener("pointerrawupdate", this._onPointerRawUpdate); } catch (_) {}
    try { dom?.removeEventListener("pointerdown", this._onPointerDownCapture, { capture: true }); } catch (_) {
      try { dom?.removeEventListener("pointerdown", this._onPointerDownCapture); } catch (_) {}
    }
    try { dom?.removeEventListener("pointerdown", this._onDbgDomPointerDown); } catch (_) {}
    try { dom?.removeEventListener("pointermove", this._onDbgDomPointerMove); } catch (_) {}
    try { dom?.removeEventListener("pointerup", this._onDbgDomPointerUp); } catch (_) {}
    try { window.removeEventListener("keydown", this._onKeyDown); } catch (_) {}
    try { window.removeEventListener("resize", this._onWindowResize); } catch (_) {}
    try { window.removeEventListener("scroll", this._onWindowScroll, true); } catch (_) {}
    try { window.removeEventListener("pointerdown", this._onWindowPointerDown, true); } catch (_) {}
    try { document.removeEventListener("pointerdown", this._onDbgDocPointerDown); } catch (_) {}
    try { document.removeEventListener("pointermove", this._onDbgDocPointerMove); } catch (_) {}
    try { document.removeEventListener("pointerup", this._onDbgDocPointerUp); } catch (_) {}
    try { document.removeEventListener("dragstart", this._onDbgDocDragStart); } catch (_) {}
    try { document.removeEventListener("dragend", this._onDbgDocDragEnd); } catch (_) {}
    try { document.removeEventListener("dragover", this._onDbgDocDragOver); } catch (_) {}
    try { document.removeEventListener("drop", this._onDbgDocDrop); } catch (_) {}
    try { document.removeEventListener("pointermove", this._onLabelDragPointerMove); } catch (_) {}
    try { document.removeEventListener("pointerup", this._onLabelDragPointerUp); } catch (_) {}
    try { document.removeEventListener("pointercancel", this._onLabelDragPointerCancel); } catch (_) {}
    try { this._ui?.btn?.removeEventListener("click", this._onBtnClick); } catch (_) {}
    try { this._ui?.hideBtn?.removeEventListener("click", this._onHideBtnClick); } catch (_) {}
    try { this._ui?.menu?.removeEventListener("pointerdown", this._onMenuPointerDown); } catch (_) {}
    try { this._ui?.menu?.removeEventListener("click", this._onMenuClick); } catch (_) {}
    try { this._ui?.canvasMenu?.removeEventListener("pointerdown", this._onCanvasMenuPointerDown); } catch (_) {}
    try { this._ui?.canvasMenu?.removeEventListener("click", this._onCanvasMenuClick); } catch (_) {}
    try { dom?.removeEventListener("contextmenu", this._onCanvasContextMenu, { capture: true }); } catch (_) {
      try { dom?.removeEventListener("contextmenu", this._onCanvasContextMenu); } catch (_) {}
    }
    try {
      const controls = this.viewer?.controls;
      if (controls && typeof controls.removeEventListener === "function") {
        try { controls.removeEventListener("start", this._onControlsStart); } catch (_) {}
        try { controls.removeEventListener("end", this._onControlsEnd); } catch (_) {}
      }
    } catch (_) {}
    try { this.#cancelShowAfterStop(); } catch (_) {}

    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;

    try { this._markers.forEach((m) => m?.el?.remove?.()); } catch (_) {}
    this._markers.length = 0;

    try { this._ui?.ghost?.remove?.(); } catch (_) {}
    try { this._ui?.dragGhost?.remove?.(); } catch (_) {}
    try { this._ui?.actions?.remove?.(); } catch (_) {}
    try { this._ui?.menu?.remove?.(); } catch (_) {}
    try { this._ui?.canvasMenu?.remove?.(); } catch (_) {}
  }

  startPlacement() {
    if (!this._editingEnabled || this._placing || this._labelsHidden) return;
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
    // no-op: debug logging disabled
  }

  #dispatchLabelEvent(name, detail, legacyName = null) {
    try {
      const ev = new CustomEvent(name, { detail, bubbles: true });
      this.container?.dispatchEvent?.(ev);
    } catch (_) {}
    if (!legacyName) return;
    try {
      const ev = new CustomEvent(legacyName, { detail, bubbles: true });
      this.container?.dispatchEvent?.(ev);
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
    const clipPlanes = {
      x: this.#getAxisPlaneState('x', planes?.[0]),
      y: this.#getAxisPlaneState('y', planes?.[1]),
      z: this.#getAxisPlaneState('z', planes?.[2]),
    };

    return {
      camera: cam,
      modelTransform,
      clipping: { constants: clipConstants, planes: clipPlanes },
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
    this.#applyClippingFromState(sceneState);

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
      const byAxis = sceneState?.clipping?.planes || null;
      if (byAxis && typeof viewer.setSection === "function") {
        ["x", "y", "z"].forEach((axis) => {
          const s = byAxis?.[axis] || null;
          const enabled = !!s?.enabled;
          const dist = Number(s?.distance);
          viewer.setSection(axis, enabled, (enabled && Number.isFinite(dist)) ? dist : 0);
        });
        return;
      }
      const constants = sceneState?.clipping?.constants || [];
      if (typeof viewer.setSection === "function") {
        ["x", "y", "z"].forEach((axis, i) => {
          const c = constants[i];
          const enabled = Number.isFinite(c);
          const dist = this.#getAxisDistanceFromConstant(axis, c);
          viewer.setSection(axis, enabled, (enabled && Number.isFinite(dist)) ? dist : 0);
        });
      }
    } catch (_) {}
  }

  #getAxisPlaneState(axis, plane) {
    if (!plane) return { enabled: false, distance: null };
    const constant = plane.constant;
    const enabled = Number.isFinite(constant);
    if (!enabled) return { enabled: false, distance: null };
    const distance = this.#getAxisDistanceFromPlane(axis, plane);
    return { enabled: true, distance };
  }

  #getAxisDistanceFromPlane(axis, plane) {
    if (!plane || !Number.isFinite(plane.constant)) return null;
    const n = plane.normal || null;
    const nx = Number(n?.x ?? 1);
    const ny = Number(n?.y ?? 1);
    const nz = Number(n?.z ?? 1);
    const sign = (axis === 'x') ? (nx >= 0 ? 1 : -1)
      : (axis === 'y') ? (ny >= 0 ? 1 : -1)
        : (nz >= 0 ? 1 : -1);
    return (sign > 0) ? -Number(plane.constant) : Number(plane.constant);
  }

  #getAxisDistanceFromConstant(axis, constant) {
    if (!Number.isFinite(constant)) return null;
    const viewer = this.viewer;
    const planes = viewer?.clipping?.planes || [];
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const plane = planes[idx] || null;
    const n = plane?.normal || null;
    const nx = Number(n?.x ?? 1);
    const ny = Number(n?.y ?? 1);
    const nz = Number(n?.z ?? 1);
    const sign = (axis === 'x') ? (nx >= 0 ? 1 : -1)
      : (axis === 'y') ? (ny >= 0 ? 1 : -1)
        : (nz >= 0 ? 1 : -1);
    return (sign > 0) ? -Number(constant) : Number(constant);
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
    const actions = document.createElement("div");
    actions.className = "ifc-label-actions";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ifc-label-add-btn";
    btn.textContent = "+ Добавить метку";

    const hideBtn = document.createElement("button");
    hideBtn.type = "button";
    hideBtn.className = "ifc-label-hide-btn";
    hideBtn.textContent = "Скрыть метки";
    hideBtn.setAttribute("aria-pressed", "false");
    hideBtn.style.display = "none";

    actions.appendChild(btn);
    actions.appendChild(hideBtn);

    const ghost = document.createElement("div");
    ghost.className = "ifc-label-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.display = "none";
    // Базовая позиция: двигаем transform'ом, поэтому left/top держим в 0
    ghost.style.left = "0px";
    ghost.style.top = "0px";

    const dot = document.createElement("div");
    dot.className = "ifc-label-dot";
    const num = document.createElement("div");
    num.className = "ifc-label-num";

    ghost.appendChild(dot);
    ghost.appendChild(num);

    const dragGhost = document.createElement("div");
    dragGhost.className = "ifc-label-ghost ifc-label-ghost--drag";
    dragGhost.setAttribute("aria-hidden", "true");
    // Фиксируем позицию, чтобы призрак не обрезался контейнером viewer
    dragGhost.style.position = "fixed";
    dragGhost.style.display = "none";
    dragGhost.style.left = "0px";
    dragGhost.style.top = "0px";

    const dragDot = document.createElement("div");
    dragDot.className = "ifc-label-dot";
    const dragNum = document.createElement("div");
    dragNum.className = "ifc-label-num";
    dragGhost.appendChild(dragDot);
    dragGhost.appendChild(dragNum);

    const menu = document.createElement("div");
    menu.className = "ifc-label-menu";
    menu.style.display = "none";
    menu.setAttribute("role", "menu");

    const menuCopy = document.createElement("button");
    menuCopy.type = "button";
    menuCopy.className = "ifc-label-menu-item";
    menuCopy.textContent = "Копировать";
    menuCopy.setAttribute("data-action", "copy");

    const menuMove = document.createElement("button");
    menuMove.type = "button";
    menuMove.className = "ifc-label-menu-item";
    menuMove.textContent = "Переместить";
    menuMove.setAttribute("data-action", "move");

    const menuDelete = document.createElement("button");
    menuDelete.type = "button";
    menuDelete.className = "ifc-label-menu-item";
    menuDelete.textContent = "Удалить";
    menuDelete.setAttribute("data-action", "delete");

    menu.appendChild(menuCopy);
    menu.appendChild(menuMove);
    menu.appendChild(menuDelete);

    const canvasMenu = document.createElement("div");
    canvasMenu.className = "ifc-label-menu";
    canvasMenu.style.display = "none";
    canvasMenu.setAttribute("role", "menu");

    const menuAdd = document.createElement("button");
    menuAdd.type = "button";
    menuAdd.className = "ifc-label-menu-item";
    menuAdd.textContent = "Добавить метку";
    menuAdd.setAttribute("data-action", "add");

    canvasMenu.appendChild(menuAdd);

    return { actions, btn, hideBtn, ghost, dot, num, dragGhost, dragNum, menu, canvasMenu, menuAdd };
  }

  #attachUi() {
    // Важно: container должен быть position:relative (в index.html уже так).
    this.container.appendChild(this._ui.actions);
    this.container.appendChild(this._ui.ghost);
    // Призрак перетаскивания добавляем в body, чтобы не обрезался overflow контейнера
    if (document?.body) {
      document.body.appendChild(this._ui.dragGhost);
      this._labelDrag.ghostInBody = true;
    } else {
      this.container.appendChild(this._ui.dragGhost);
      this._labelDrag.ghostInBody = false;
    }
    this.container.appendChild(this._ui.menu);
    this.container.appendChild(this._ui.canvasMenu);
  }

  #bindEvents() {
    this._onBtnClick = (e) => {
      // Не даём событию уйти в canvas/OrbitControls и не ставим метку "тем же кликом".
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
      if (!this._editingEnabled) return;
      this.startPlacement();
    };
    this._ui.btn.addEventListener("click", this._onBtnClick, { passive: false });

    this._onHideBtnClick = (e) => {
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
      if (!this._markers.length) return;
      this.#setLabelsHidden(!this._labelsHidden);
    };
    this._ui.hideBtn.addEventListener("click", this._onHideBtnClick, { passive: false });

    this._onMenuPointerDown = (e) => {
      // Не даём клику меню попасть в canvas/OrbitControls
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
    };
    this._ui.menu.addEventListener("pointerdown", this._onMenuPointerDown, { passive: false });

    this._onMenuClick = (e) => {
      const target = e.target;
      const action = target?.getAttribute?.("data-action");
      if (!action) return;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      const marker = this._contextMenu?.marker || null;
      this.#emitLabelAction(action, marker);
      this.#closeContextMenu();
    };
    this._ui.menu.addEventListener("click", this._onMenuClick);

    this._onCanvasMenuPointerDown = (e) => {
      // Не даём клику меню попасть в canvas/OrbitControls
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
    };
    this._ui.canvasMenu.addEventListener("pointerdown", this._onCanvasMenuPointerDown, { passive: false });

    this._onCanvasMenuClick = (e) => {
      const target = e.target;
      const action = target?.getAttribute?.("data-action");
      if (action !== "add") return;
      if (!this._editingEnabled) return;
      if (this._labelsHidden) return;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}

      const hit = this._canvasMenu?.hit || null;
      if (hit) this.#createMarkerAtHit(hit);
      this.#closeCanvasMenu();
    };
    this._ui.canvasMenu.addEventListener("click", this._onCanvasMenuClick);

    this._onKeyDown = (e) => {
      if (this._placing) {
        if (e.key === "Escape") this.cancelPlacement();
        return;
      }
      if (!this._editingEnabled) return;

      const target = e.target;
      const tag = (target && target.tagName) ? String(target.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      const hasSelection = this.#getSelectedMarker() != null;
      if (!hasSelection) return;

      const key = String(e.key || "").toLowerCase();
      const withCmd = !!(e.ctrlKey || e.metaKey);

      if (withCmd && key === "c") {
        try { e.preventDefault(); } catch (_) {}
        this.#emitLabelAction("copy");
        return;
      }
      if (key === "delete" || key === "backspace") {
        try { e.preventDefault(); } catch (_) {}
        this.#emitLabelAction("delete");
        return;
      }
      if (key === "m" || (withCmd && key === "m")) {
        try { e.preventDefault(); } catch (_) {}
        this.#emitLabelAction("move");
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    this._onWindowPointerDown = (e) => {
      if (!this._contextMenu.open && !this._canvasMenu.open) return;
      const menu = this._ui?.menu;
      const canvasMenu = this._ui?.canvasMenu;
      if (menu && menu.contains(e.target)) return;
      if (canvasMenu && canvasMenu.contains(e.target)) return;
      this.#closeContextMenu();
      this.#closeCanvasMenu();
    };
    window.addEventListener("pointerdown", this._onWindowPointerDown, true);

    // Смещение контейнера (#app) относительно viewport может меняться при resize/scroll.
    // Обновляем кэш, чтобы призрак/метки не "плыли".
    this._onWindowResize = () => {
      this.#refreshContainerOffset();
      if (this._placing) this.#syncGhost();
      this.#closeContextMenu();
    };
    this._onWindowScroll = () => {
      this.#refreshContainerOffset();
      if (this._placing) this.#syncGhost();
      this.#closeContextMenu();
    };
    window.addEventListener("resize", this._onWindowResize, { passive: true });
    // scroll слушаем в capture, чтобы ловить скролл вложенных контейнеров
    window.addEventListener("scroll", this._onWindowScroll, true);

    const logDnDEvent = (scope, e) => {
      const target = e?.target || null;
      const closestMarker = (target && typeof target.closest === "function")
        ? target.closest(".ifc-label-marker")
        : null;
      if (!closestMarker) return;
      // debug logging disabled
    };

    this._onDbgDocPointerDown = (e) => logDnDEvent("document", e);
    this._onDbgDocPointerMove = (e) => logDnDEvent("document", e);
    this._onDbgDocPointerUp = (e) => logDnDEvent("document", e);
    this._onDbgDocDragStart = (e) => logDnDEvent("document", e);
    this._onDbgDocDragEnd = (e) => logDnDEvent("document", e);
    this._onDbgDocDragOver = (e) => logDnDEvent("document", e);
    this._onDbgDocDrop = (e) => logDnDEvent("document", e);

    document.addEventListener("pointerdown", this._onDbgDocPointerDown);
    document.addEventListener("pointermove", this._onDbgDocPointerMove);
    document.addEventListener("pointerup", this._onDbgDocPointerUp);
    document.addEventListener("dragstart", this._onDbgDocDragStart);
    document.addEventListener("dragend", this._onDbgDocDragEnd);
    document.addEventListener("dragover", this._onDbgDocDragOver);
    document.addEventListener("drop", this._onDbgDocDrop);

    this._onLabelDragPointerMove = (e) => this.#updateLabelDrag(e);
    this._onLabelDragPointerUp = (e) => this.#finishLabelDrag(e, "pointerup");
    this._onLabelDragPointerCancel = (e) => this.#finishLabelDrag(e, "pointercancel");

    document.addEventListener("pointermove", this._onLabelDragPointerMove, { passive: true });
    document.addEventListener("pointerup", this._onLabelDragPointerUp, { passive: true });
    document.addEventListener("pointercancel", this._onLabelDragPointerCancel, { passive: true });

    const dom = this.viewer?.renderer?.domElement;
    if (!dom) return;

    this._onDbgDomPointerDown = (e) => logDnDEvent("ifc3dHost", e);
    this._onDbgDomPointerMove = (e) => logDnDEvent("ifc3dHost", e);
    this._onDbgDomPointerUp = (e) => logDnDEvent("ifc3dHost", e);

    dom.addEventListener("pointerdown", this._onDbgDomPointerDown, { passive: true });
    dom.addEventListener("pointermove", this._onDbgDomPointerMove, { passive: true });
    dom.addEventListener("pointerup", this._onDbgDomPointerUp, { passive: true });

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

    this._onCanvasContextMenu = (e) => {
      // Контекстное меню добавления метки по ПКМ на модели (если нет метки под курсором).
      if (!this._editingEnabled) return;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
      try { this.cancelPlacement(); } catch (_) {}

      const el = document.elementFromPoint?.(e.clientX, e.clientY);
      if (el && el.closest?.(".ifc-label-marker")) return;
      if (el && el.closest?.(".ifc-label-menu")) return;

      const hit = this.#pickModelPoint(e.clientX, e.clientY);
      if (!hit) return;

      this.#closeContextMenu();
      this.#openCanvasMenu(hit, e.clientX, e.clientY);
    };
    dom.addEventListener("contextmenu", this._onCanvasContextMenu, { capture: true, passive: false });

    const controls = this.viewer?.controls;
    if (controls && typeof controls.addEventListener === "function") {
      this._onControlsStart = () => {
        this.#beginAutoHideForControls();
      };
      this._onControlsEnd = () => {
        this.#scheduleShowAfterStop();
      };
      try { controls.addEventListener("start", this._onControlsStart); } catch (_) {}
      try { controls.addEventListener("end", this._onControlsEnd); } catch (_) {}
    }

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

  #setDragGhostVisible(visible) {
    if (!this._ui?.dragGhost) return;
    this._ui.dragGhost.style.display = visible ? "block" : "none";
  }

  #applyDragGhostTransform() {
    const g = this._ui?.dragGhost;
    if (!g) return;
    g.style.transform = `translate3d(${this._labelDrag.ghostPos.x}px, ${this._labelDrag.ghostPos.y}px, 0) translate(-50%, -50%)`;
  }

  #updateDragGhostFromClient(clientX, clientY) {
    this._labelDrag.last = { x: clientX, y: clientY };
    let x = clientX;
    let y = clientY;
    if (!this._labelDrag.ghostInBody) {
      if (!this._containerOffsetValid) this.#refreshContainerOffset();
      x = (clientX - this._containerOffset.left);
      y = (clientY - this._containerOffset.top);
    }
    this._labelDrag.ghostPos.x = x;
    this._labelDrag.ghostPos.y = y;
    this.#applyDragGhostTransform();
  }

  #beginLabelDrag(marker, e) {
    if (!marker || !e || e.button !== 0) return;
    this._labelDrag.active = true;
    this._labelDrag.moved = false;
    this._labelDrag.pointerId = e.pointerId ?? null;
    this._labelDrag.id = marker.id;
    this._labelDrag.start = { x: e.clientX, y: e.clientY };
    this._labelDrag.last = { x: e.clientX, y: e.clientY };
    this._labelDrag.clickMarker = marker;

    try {
      this._labelDrag.prevControlsEnabled = this.viewer?.controls?.enabled ?? null;
      if (this.viewer?.controls) this.viewer.controls.enabled = false;
    } catch (_) {}

    if (this._ui?.dragNum) this._ui.dragNum.textContent = String(marker.id);
    this.#setDragGhostVisible(false);

    try { marker.el?.setPointerCapture?.(e.pointerId); } catch (_) {}

    this.#dispatchLabelEvent("ifcviewer:label-drag-start", {
      id: marker.id,
      clientX: e.clientX,
      clientY: e.clientY,
    }, null);
  }

  #updateLabelDrag(e) {
    if (!this._labelDrag.active || !e) return;
    if (this._labelDrag.pointerId != null && e.pointerId != null && e.pointerId !== this._labelDrag.pointerId) return;

    const dx = (e.clientX - this._labelDrag.start.x);
    const dy = (e.clientY - this._labelDrag.start.y);
    const dist = Math.hypot(dx, dy);
    if (!this._labelDrag.moved && dist >= this._labelDrag.threshold) {
      this._labelDrag.moved = true;
      this.#setDragGhostVisible(true);
    }

    if (this._labelDrag.moved) {
      this.#updateDragGhostFromClient(e.clientX, e.clientY);
    }
  }

  #resolveDropTarget(clientX, clientY) {
    const el = document.elementFromPoint?.(clientX, clientY) || null;
    if (!el) return { element: null, card: null };
    if (!this._labelDragDropSelector) return { element: el, card: null };
    const card = el.closest?.(this._labelDragDropSelector) || null;
    return { element: el, card };
  }

  #finishLabelDrag(e, reason = "pointerup") {
    if (!this._labelDrag.active) return;
    const marker = this._labelDrag.clickMarker;
    const moved = !!this._labelDrag.moved;
    const clientX = e?.clientX ?? this._labelDrag.last.x;
    const clientY = e?.clientY ?? this._labelDrag.last.y;
    this.logger?.log?.("[LabelClickDbg]", {
      phase: "finish",
      moved: !!moved,
      id: marker?.id ?? this._labelDrag.id,
    });

    this._labelDrag.active = false;
    this._labelDrag.moved = false;
    this._labelDrag.pointerId = null;
    this._labelDrag.id = null;
    this._labelDrag.clickMarker = null;

    this.#setDragGhostVisible(false);

    try {
      if (this.viewer?.controls && this._labelDrag.prevControlsEnabled != null) {
        this.viewer.controls.enabled = !!this._labelDrag.prevControlsEnabled;
      }
    } catch (_) {}
    this._labelDrag.prevControlsEnabled = null;

    if (!moved) {
      if (marker) this.#handleMarkerClick(marker);
      return;
    }

    const drop = this.#resolveDropTarget(clientX, clientY);
    this.#dispatchLabelEvent("ifcviewer:label-drop", {
      id: marker?.id ?? this._labelDrag.id,
      clientX,
      clientY,
      dropTarget: drop.card || null,
      elementFromPoint: drop.element || null,
      reason,
    }, null);
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
    if (!hits || hits.length <= 0) return null;

    // ВАЖНО: у модели могут быть контурные линии/оверлеи (LineSegments),
    // которые перехватывают hit раньше "реального" Mesh фасада.
    // Для постановки метки выбираем первый hit именно по Mesh.
    let best = null;
    for (const h of hits) {
      if (!h || !h.point) continue;
      if (this.#isPointClippedBySection(h.point)) continue;
      const obj = h.object;
      if (obj && obj.isMesh) { best = h; break; }
    }
    // fallback: если Mesh не найден (редко), берём первый валидный hit
    if (!best) {
      for (const h of hits) {
        if (h && h.point) { best = h; break; }
      }
    }

    if (!best || !best.point) return null;
    return best;
  }

  #createMarkerAtHit(hit) {
    const model = this.viewer?.activeModel;
    if (!model) return;

    const id = this._nextId++;

    // Храним локальную координату модели, чтобы метка оставалась “приклеенной” к модели
    this._tmpLocal.copy(hit.point);
    model.worldToLocal(this._tmpLocal);

    const sceneState = this.#captureSceneState();
    const marker = this.#createMarkerFromData({
      id,
      localPoint: { x: this._tmpLocal.x, y: this._tmpLocal.y, z: this._tmpLocal.z },
      sceneState,
    }, true);

    this.#log("placed", {
      id,
      local: { x: +marker.localPoint.x.toFixed(4), y: +marker.localPoint.y.toFixed(4), z: +marker.localPoint.z.toFixed(4) },
      sceneState: sceneState ? { hasCamera: !!sceneState.camera, hasModel: !!sceneState.modelTransform, hasClip: !!sceneState.clipping } : null,
    });
  }

  #createMarkerElement(id) {
    const el = document.createElement("div");
    el.className = "ifc-label-marker";
    el.setAttribute("data-id", String(id));
    el.innerHTML = `<div class="ifc-label-dot"></div><div class="ifc-label-num">${id}</div>`;
    // Базовая позиция: двигаем transform'ом, поэтому left/top держим в 0
    el.style.left = "0px";
    el.style.top = "0px";
    this.container.appendChild(el);
    return el;
  }

  #setSelectedMarker(marker) {
    if (!marker) {
      this.#clearSelection();
      return;
    }
    if (this._selectedId === marker.id) return;
    this.#clearSelection();
    this._selectedId = marker.id;
    try { marker.el?.classList?.add?.("ifc-label-marker--active"); } catch (_) {}
  }

  #clearSelection() {
    if (this._selectedId == null) return;
    const marker = this._markers.find((m) => String(m?.id) === String(this._selectedId));
    try { marker?.el?.classList?.remove?.("ifc-label-marker--active"); } catch (_) {}
    this._selectedId = null;
  }

  #getSelectedMarker() {
    if (this._selectedId == null) return null;
    return this._markers.find((m) => String(m?.id) === String(this._selectedId)) || null;
  }

  #handleMarkerClick(marker) {
    if (!marker) return;
    this.#closeContextMenu();
    this.#setSelectedMarker(marker);
    this.#dispatchLabelEvent("ifcviewer:label-click", {
      id: marker.id,
      sceneState: marker.sceneState || null,
    }, "ifcviewer:card-click");
    // "Долеталка" камеры: быстрый старт + мягкий конец
    this.#animateToSceneState(marker.sceneState, 550);
  }

  #buildActionPayload(marker) {
    if (!marker) return null;
    return {
      id: marker.id,
      localPoint: { x: marker.localPoint.x, y: marker.localPoint.y, z: marker.localPoint.z },
      sceneState: marker.sceneState || null,
    };
  }

  #emitLabelAction(action, marker = null) {
    if (!this._editingEnabled) return;
    const target = marker || this.#getSelectedMarker();
    if (!target) return;
    const detail = this.#buildActionPayload(target);
    if (!detail) return;
    this.#dispatchLabelEvent(`ifcviewer:label-${action}`, detail, null);
  }

  #openContextMenu(marker, clientX, clientY) {
    if (!this._editingEnabled) return;
    const menu = this._ui?.menu;
    if (!menu || !marker) return;

    this.#closeContextMenu();

    this._contextMenu.open = true;
    this._contextMenu.marker = marker;

    if (!this._containerOffsetValid) this.#refreshContainerOffset();
    const x = clientX - this._containerOffset.left;
    const y = clientY - this._containerOffset.top;

    menu.style.display = "block";
    // Зафиксируем базовую точку, чтобы transform не смещался от offsetTop/Left
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.transform = `translate3d(${x}px, ${y}px, 0) translate(8px, 8px)`;

    // Корректируем позицию, чтобы не выходить за контейнер
    try {
      const rect = this.container?.getBoundingClientRect?.();
      const mw = menu.offsetWidth || 0;
      const mh = menu.offsetHeight || 0;
      if (rect && mw && mh) {
        let px = x + 8;
        let py = y + 8;
        if (px + mw > rect.width) px = Math.max(0, rect.width - mw - 4);
        if (py + mh > rect.height) py = Math.max(0, rect.height - mh - 4);
        menu.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      }
    } catch (_) {}
  }

  #closeContextMenu() {
    const menu = this._ui?.menu;
    if (!menu) return;
    this._contextMenu.open = false;
    this._contextMenu.marker = null;
    menu.style.display = "none";
  }

  #openCanvasMenu(hit, clientX, clientY) {
    const menu = this._ui?.canvasMenu;
    if (!menu || !hit) return;

    this.#closeCanvasMenu();

    this._canvasMenu.open = true;
    this._canvasMenu.hit = hit;

    if (!this._containerOffsetValid) this.#refreshContainerOffset();
    const x = clientX - this._containerOffset.left;
    const y = clientY - this._containerOffset.top;

    menu.style.display = "block";
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.transform = `translate3d(${x}px, ${y}px, 0) translate(8px, 8px)`;

    try {
      const rect = this.container?.getBoundingClientRect?.();
      const mw = menu.offsetWidth || 0;
      const mh = menu.offsetHeight || 0;
      if (rect && mw && mh) {
        let px = x + 8;
        let py = y + 8;
        if (px + mw > rect.width) px = Math.max(0, rect.width - mw - 4);
        if (py + mh > rect.height) py = Math.max(0, rect.height - mh - 4);
        menu.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      }
    } catch (_) {}
  }

  #closeCanvasMenu() {
    const menu = this._ui?.canvasMenu;
    if (!menu) return;
    this._canvasMenu.open = false;
    this._canvasMenu.hit = null;
    menu.style.display = "none";
  }

  #createMarkerFromData(data, emitPlacedEvent) {
    if (!data) return null;
    const localPoint = data.localPoint || {};
    const marker = new LabelMarker({
      id: data.id,
      localPoint: new THREE.Vector3(
        Number(localPoint.x) || 0,
        Number(localPoint.y) || 0,
        Number(localPoint.z) || 0
      ),
      el: this.#createMarkerElement(data.id),
      sceneState: data.sceneState || null,
    });
    this._markers.push(marker);
    this.#syncHideButton();

    const onMarkerPointerDown = (e) => {
      this.logger?.log?.("[LabelClickDbg]", {
        phase: "down",
        button: e?.button,
        buttons: e?.buttons,
        clientX: e?.clientX,
        clientY: e?.clientY,
        pointerId: e?.pointerId,
      });
      // Важно: не даём клику попасть в canvas/OrbitControls
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
      // если были в режиме постановки — выходим
      try { this.cancelPlacement(); } catch (_) {}

      if (!this._editingEnabled) {
        this.#handleMarkerClick(marker);
        return;
      }

      if (e.button === 0) {
        this.#closeContextMenu();
        this.#setSelectedMarker(marker);
        this.#beginLabelDrag(marker, e);
      }
    };
    // capture-phase, чтобы обогнать любые handlers на canvas
    try { marker.el.addEventListener("pointerdown", onMarkerPointerDown, { capture: true, passive: false }); } catch (_) {
      try { marker.el.addEventListener("pointerdown", onMarkerPointerDown); } catch (_) {}
    }
    const onMarkerPointerUp = (e) => {
      this.logger?.log?.("[LabelClickDbg]", {
        phase: "up",
        button: e?.button,
        buttons: e?.buttons,
        clientX: e?.clientX,
        clientY: e?.clientY,
        pointerId: e?.pointerId,
      });
    };
    try { marker.el.addEventListener("pointerup", onMarkerPointerUp, { capture: true, passive: true }); } catch (_) {
      try { marker.el.addEventListener("pointerup", onMarkerPointerUp); } catch (_) {}
    }
    const onMarkerDragStart = (e) => {
    };
    const onMarkerDragEnd = (e) => {
    };
    try { marker.el.addEventListener("dragstart", onMarkerDragStart); } catch (_) {}
    try { marker.el.addEventListener("dragend", onMarkerDragEnd); } catch (_) {}

    const onMarkerContextMenu = (e) => {
      if (!this._editingEnabled) return;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      try { e.stopImmediatePropagation?.(); } catch (_) {}
      try { this.cancelPlacement(); } catch (_) {}

      this.#setSelectedMarker(marker);
      this.#openContextMenu(marker, e.clientX, e.clientY);
    };
    try { marker.el.addEventListener("contextmenu", onMarkerContextMenu, { capture: true, passive: false }); } catch (_) {
      try { marker.el.addEventListener("contextmenu", onMarkerContextMenu); } catch (_) {}
    }

    if (emitPlacedEvent) {
      this.#dispatchLabelEvent("ifcviewer:label-placed", {
        id: marker.id,
        localPoint: { x: marker.localPoint.x, y: marker.localPoint.y, z: marker.localPoint.z },
        sceneState: marker.sceneState || null,
      }, "ifcviewer:card-placed");
    }

    return marker;
  }

  #clearMarkers() {
    try { this._markers.forEach((m) => m?.el?.remove?.()); } catch (_) {}
    this._markers.length = 0;
    this.#clearSelection();
  }

  setLabelMarkers(items) {
    if (!Array.isArray(items)) return;
    const prevSelectedId = this._selectedId;
    this.#clearMarkers();

    let maxNumericId = null;
    for (const item of items) {
      const marker = this.#createMarkerFromData(item, false);
      if (marker && typeof marker.id === "number" && Number.isFinite(marker.id)) {
        maxNumericId = (maxNumericId == null) ? marker.id : Math.max(maxNumericId, marker.id);
      }
    }
    if (maxNumericId != null) this._nextId = Math.max(1, Math.floor(maxNumericId) + 1);
    if (prevSelectedId != null) this.selectLabel(prevSelectedId);
    this.#syncHideButton();
  }

  getLabelMarkers() {
    return this._markers.map((m) => ({
      id: m.id,
      localPoint: { x: m.localPoint.x, y: m.localPoint.y, z: m.localPoint.z },
      sceneState: m.sceneState || null,
    }));
  }

  /**
   * @deprecated используйте setLabelMarkers
   */
  setCardMarkers(items) {
    this.setLabelMarkers(items);
  }

  /**
   * @deprecated используйте getLabelMarkers
   */
  getCardMarkers() {
    return this.getLabelMarkers();
  }

  selectLabel(id) {
    if (id == null) {
      this.#clearSelection();
      return;
    }
    const marker = this._markers.find((m) => String(m?.id) === String(id)) || null;
    if (!marker) {
      this.#clearSelection();
      return;
    }
    this.#setSelectedMarker(marker);
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

      if (this._labelsHidden) {
        this.#setMarkerVisibility(m, false, "labelsHidden");
        continue;
      }

      if (!model) {
        this.#setMarkerVisibility(m, false, "noModel");
        continue;
      }

      // local -> world (учитывает позицию/поворот/scale модели)
      this._tmpV.copy(m.localPoint);
      model.localToWorld(this._tmpV);

      if (this.#isPointClippedBySection(this._tmpV)) {
        this.#setMarkerVisibility(m, false, "clipped");
        continue;
      }

      const ndc = this._tmpNdc.copy(this._tmpV).project(camera);

      // Если точка за камерой или вне кадра — скрываем
      const ndcFinite = Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z);
      const inView = ndcFinite
        && ndc.x >= -1 && ndc.x <= 1
        && ndc.y >= -1 && ndc.y <= 1
        && ndc.z >= -1 && ndc.z <= 1;
      if (!inView) {
        this.#setMarkerVisibility(m, false, "outOfView");
        continue;
      }

      const x = (ndc.x * 0.5 + 0.5) * w;
      const y = (-ndc.y * 0.5 + 0.5) * h;

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        this.#setMarkerVisibility(m, false, "invalidScreen");
        continue;
      }

      const occluded = this.#isPointOccludedByModel(this._tmpV, ndc, model, camera);
      if (occluded) {
        this.#setMarkerVisibility(m, false, "occluded");
        continue;
      }

      this.#setMarkerVisibility(m, true, "visible");
      m.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    }
  }

  #setMarkerVisibility(marker, visible, reason) {
    if (!marker || !marker.el) return;
    if (visible) {
      marker.el.style.display = "block";
      try { marker.el.classList.remove("ifc-label-marker--hidden"); } catch (_) {}
    } else {
      try { marker.el.classList.add("ifc-label-marker--hidden"); } catch (_) {}
      marker.el.style.display = "block";
    }
    if (!this._visibilityLogEnabled) return;
    if (marker.visible === visible && marker.hiddenReason === reason) return;
    marker.visible = visible;
    marker.hiddenReason = reason;
    this.logger?.log?.("[LabelVisibility]", {
      id: marker.id,
      visible,
      reason,
    });
  }

  #isPointOccludedByModel(pointWorld, ndc, model, camera) {
    if (!pointWorld || !ndc || !model || !camera) return false;
    this._raycaster.setFromCamera(ndc, camera);
    const hits = this._raycaster.intersectObject(model, true);
    if (!hits || hits.length === 0) return false;
    let hit = null;
    for (const h of hits) {
      if (!h || !h.object || !h.object.isMesh) continue;
      if (this.#isPointClippedBySection(h.point)) continue;
      hit = h;
      break;
    }
    if (!hit || !Number.isFinite(hit.distance)) return false;
    const ray = this._raycaster.ray;
    this._tmpV2.copy(pointWorld).sub(ray.origin);
    const t = this._tmpV2.dot(ray.direction);
    if (!Number.isFinite(t) || t <= 0) return false;
    const epsilon = 1e-2;
    return hit.distance + epsilon < t;
  }

  #isPointClippedBySection(pointWorld) {
    const planes = this.viewer?.clipping?.planes || [];
    for (const plane of planes) {
      if (!plane || !Number.isFinite(plane.constant)) continue;
      const signed = plane.distanceToPoint(pointWorld);
      if (signed < -1e-4) return true;
    }
    return false;
  }

  #copyMatrix(matrix, cache) {
    if (!matrix || !cache || cache.length !== 16) return;
    const e = matrix.elements;
    for (let i = 0; i < 16; i += 1) cache[i] = e[i] ?? 0;
  }

  #setLabelsHidden(hidden) {
    const next = !!hidden;
    if (this._labelsHidden === next) return;
    this._labelsHidden = next;
    if (this._labelsHidden) {
      try { this.cancelPlacement(); } catch (_) {}
      try { this.#closeContextMenu(); } catch (_) {}
      try { this.#closeCanvasMenu(); } catch (_) {}
    }
    this.#syncHideButton();
  }

  #beginAutoHideForControls() {
    if (!this._autoHide.active) {
      this._autoHide.prevHidden = this._labelsHidden;
      this._autoHide.active = true;
    }
    this._labelsHidden = true;
    this.#syncHideButton();
    this.#cancelShowAfterStop();
  }

  #scheduleShowAfterStop() {
    if (!this._autoHide.active) return;
    const cam = this.viewer?.camera;
    if (!cam) return;
    this._showAfterStop.active = true;
    this._showAfterStop.lastChangeTs = performance.now();
    this.#copyMatrix(cam.matrixWorld, this._showAfterStop.lastCamMatrix);
    if (!this._showAfterStop.raf) {
      this._showAfterStop.raf = requestAnimationFrame(() => this.#tickShowAfterStop());
    }
  }

  #cancelShowAfterStop() {
    if (this._showAfterStop.raf) cancelAnimationFrame(this._showAfterStop.raf);
    this._showAfterStop.raf = 0;
    this._showAfterStop.active = false;
  }

  #tickShowAfterStop() {
    if (!this._showAfterStop.active) {
      this._showAfterStop.raf = 0;
      return;
    }
    const cam = this.viewer?.camera;
    if (!cam) {
      this._showAfterStop.raf = 0;
      return;
    }
    const now = performance.now();
    if (!this.#isCameraStable(cam.matrixWorld, this._showAfterStop.lastCamMatrix, this._showAfterStop.eps)) {
      this._showAfterStop.lastChangeTs = now;
    }
    if (now - this._showAfterStop.lastChangeTs >= this._showAfterStop.idleMs) {
      this._labelsHidden = this._autoHide.prevHidden;
      this._autoHide.active = false;
      this.#syncHideButton();
      this._showAfterStop.active = false;
      this._showAfterStop.raf = 0;
      return;
    }
    this._showAfterStop.raf = requestAnimationFrame(() => this.#tickShowAfterStop());
  }

  #isCameraStable(matrix, cache, eps) {
    if (!matrix || !cache || cache.length !== 16) return true;
    const e = matrix.elements;
    let stable = true;
    for (let i = 0; i < 16; i += 1) {
      const v = e[i] ?? 0;
      const d = Math.abs(v - cache[i]);
      if (d > eps) stable = false;
      cache[i] = v;
    }
    return stable;
  }

  #syncHideButton() {
    const btn = this._ui?.hideBtn;
    if (!btn) return;
    const hasMarkers = this._markers.length > 0;
    btn.style.display = hasMarkers ? "block" : "none";
    if (!hasMarkers && this._labelsHidden) {
      this._labelsHidden = false;
    }
    btn.setAttribute("aria-pressed", this._labelsHidden ? "true" : "false");
    try { btn.classList.toggle("ifc-label-hide-btn--active", this._labelsHidden); } catch (_) {}
    this.#syncAddAvailability();
  }

  #syncAddAvailability() {
    const disabled = !!this._labelsHidden || !this._editingEnabled;
    const btn = this._ui?.btn;
    if (btn) {
      btn.disabled = disabled;
      try { btn.classList.toggle("ifc-label-add-btn--disabled", disabled); } catch (_) {}
    }
    const menuAdd = this._ui?.menuAdd;
    if (menuAdd) {
      menuAdd.disabled = disabled;
      try { menuAdd.classList.toggle("ifc-label-menu-item--disabled", disabled); } catch (_) {}
    }
  }

  #syncEditingUi() {
    const actions = this._ui?.actions;
    if (actions) actions.style.display = this._editingEnabled ? "" : "none";
    if (!this._editingEnabled) {
      try { this.cancelPlacement(); } catch (_) {}
      try { this.#closeContextMenu(); } catch (_) {}
      try { this.#closeCanvasMenu(); } catch (_) {}
      this._labelDrag.active = false;
      this._labelDrag.moved = false;
      this._labelDrag.pointerId = null;
      this._labelDrag.id = null;
      this._labelDrag.clickMarker = null;
      this.#setDragGhostVisible(false);
    }
    this.#syncAddAvailability();
  }

  setEditingEnabled(enabled) {
    const next = !!enabled;
    if (this._editingEnabled === next) return;
    this._editingEnabled = next;
    this.#syncEditingUi();
  }

  getEditingEnabled() {
    return !!this._editingEnabled;
  }
}

