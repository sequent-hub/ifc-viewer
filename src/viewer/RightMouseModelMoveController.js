import * as THREE from "three";

/**
 * Right-mouse (RMB) drag controller that moves the MODEL (activeModel) in screen plane,
 * while keeping OrbitControls pivot (controls.target) fixed.
 *
 * Это восстанавливает поведение:
 * - ПКМ: "таскаем" модель относительно оси (pivot остаётся на месте)
 * - ЛКМ: вращаем вокруг pivot (модель может ездить по окружности)
 */
export class RightMouseModelMoveController {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.domElement
   * @param {() => (THREE.Camera|null)} deps.getCamera
   * @param {() => (import('three/examples/jsm/controls/OrbitControls').OrbitControls|null)} deps.getControls
   * @param {() => (THREE.Object3D|null)} deps.getModel
   * @param {() => boolean} [deps.isEnabled]
   * @param {(e: PointerEvent) => boolean} [deps.shouldIgnoreEvent]
   * @param {() => boolean} [deps.isDebug]
   * @param {(pivotWorld: THREE.Vector3) => void} [deps.onRmbStart]
   * @param {(deltaWorld: THREE.Vector3) => void} [deps.onRmbMove]
   */
  constructor(deps) {
    this.domElement = deps.domElement;
    this.getCamera = deps.getCamera;
    this.getControls = deps.getControls;
    this.getModel = deps.getModel;
    this.isEnabled = deps.isEnabled || (() => true);
    this.shouldIgnoreEvent = deps.shouldIgnoreEvent || (() => false);
    this.isDebug = deps.isDebug || (() => false);
    this.onRmbStart = typeof deps.onRmbStart === "function" ? deps.onRmbStart : null;
    this.onRmbMove = typeof deps.onRmbMove === "function" ? deps.onRmbMove : null;

    this._activePointerId = null;
    this._last = { x: 0, y: 0 };
    this._prevControlsEnabled = null;
    this._suppressContextMenu = false;

    this._vRight = new THREE.Vector3();
    this._vUp = new THREE.Vector3();
    this._vDelta = new THREE.Vector3();

    /** @type {(e: PointerEvent) => void} */
    this._onPointerDown = (e) => this.#handlePointerDown(e);
    /** @type {(e: PointerEvent) => void} */
    this._onPointerMove = (e) => this.#handlePointerMove(e);
    /** @type {(e: PointerEvent) => void} */
    this._onPointerUp = (e) => this.#handlePointerUp(e);
    /** @type {(e: MouseEvent) => void} */
    this._onContextMenu = (e) => this.#handleContextMenu(e);

    this.domElement.addEventListener("pointerdown", this._onPointerDown, { capture: true, passive: false });
    this.domElement.addEventListener("contextmenu", this._onContextMenu, { capture: true, passive: false });
  }

  dispose() {
    try { this.domElement.removeEventListener("pointerdown", this._onPointerDown, { capture: true }); } catch (_) {
      try { this.domElement.removeEventListener("pointerdown", this._onPointerDown); } catch (_) {}
    }
    try { this.domElement.removeEventListener("contextmenu", this._onContextMenu, { capture: true }); } catch (_) {
      try { this.domElement.removeEventListener("contextmenu", this._onContextMenu); } catch (_) {}
    }
    this.#stopDrag(null);
  }

  #handleContextMenu(e) {
    if (!this._suppressContextMenu) return;
    try { e.preventDefault(); } catch (_) {}
  }

  #handlePointerDown(e) {
    if (!this.isEnabled()) return;
    if (e.button !== 2) return; // RMB only
    if (this.shouldIgnoreEvent && this.shouldIgnoreEvent(e)) return;

    const camera = this.getCamera?.();
    const controls = this.getControls?.();
    const model = this.getModel?.();
    if (!camera || !controls || !model) return;

    // Блокируем context menu и OrbitControls pan на ПКМ
    this._suppressContextMenu = true;
    e.preventDefault();
    e.stopPropagation();
    // eslint-disable-next-line no-undef
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    // Сохраним pivot-ось для режима "двигаем модель вокруг оси"
    try {
      const pivot = controls.target?.clone?.();
      if (pivot && this.onRmbStart) this.onRmbStart(pivot);
    } catch (_) {}

    this._activePointerId = e.pointerId;
    this._last.x = e.clientX;
    this._last.y = e.clientY;

    // На время drag отключаем OrbitControls, чтобы он не панорамировал камеру
    try {
      this._prevControlsEnabled = !!controls.enabled;
      controls.enabled = false;
    } catch (_) {
      this._prevControlsEnabled = null;
    }

    try { this.domElement.setPointerCapture?.(e.pointerId); } catch (_) {}
    window.addEventListener("pointermove", this._onPointerMove, { passive: false });
    window.addEventListener("pointerup", this._onPointerUp, { passive: false });
    window.addEventListener("pointercancel", this._onPointerUp, { passive: false });

    if (this.isDebug()) {
      try { console.log("[RMB-ModelMove] start"); } catch (_) {}
    }
  }

  #handlePointerMove(e) {
    if (this._activePointerId == null) return;
    if (e.pointerId !== this._activePointerId) return;

    const camera = this.getCamera?.();
    const controls = this.getControls?.();
    const model = this.getModel?.();
    if (!camera || !controls || !model) return;

    const rect = this.domElement.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    e.preventDefault();
    e.stopPropagation();
    // eslint-disable-next-line no-undef
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    const dxPx = e.clientX - this._last.x;
    const dyPx = e.clientY - this._last.y;
    if (dxPx === 0 && dyPx === 0) return;
    this._last.x = e.clientX;
    this._last.y = e.clientY;

    // Перевод пикселей в world-сдвиг в плоскости экрана (right/up).
    const w = rect.width;
    const h = rect.height;
    const aspect = w / h;

    let worldPerPxX = 0;
    let worldPerPxY = 0;

    if (camera.isPerspectiveCamera) {
      // Масштабируем по расстоянию до pivot (так поведение стабильно при орбит-камере)
      const dist = camera.position.distanceTo(controls.target);
      const vFov = (camera.fov * Math.PI) / 180;
      const visibleH = 2 * dist * Math.tan(vFov / 2);
      const visibleW = visibleH * aspect;
      worldPerPxX = visibleW / w;
      worldPerPxY = visibleH / h;
    } else if (camera.isOrthographicCamera) {
      const visibleW = (camera.right - camera.left) / Math.max(1e-6, camera.zoom || 1);
      const visibleH = (camera.top - camera.bottom) / Math.max(1e-6, camera.zoom || 1);
      worldPerPxX = visibleW / w;
      worldPerPxY = visibleH / h;
    } else {
      return;
    }

    // Интуитивно: модель "идёт" за мышью.
    const moveX = dxPx * worldPerPxX;
    const moveY = -dyPx * worldPerPxY;

    try { camera.updateMatrixWorld?.(true); } catch (_) {}
    this._vRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this._vUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    this._vDelta.copy(this._vRight).multiplyScalar(moveX).add(this._vUp.multiplyScalar(moveY));

    model.position.add(this._vDelta);
    model.updateMatrixWorld?.(true);
    try { this.onRmbMove && this.onRmbMove(this._vDelta); } catch (_) {}

    if (this.isDebug()) {
      try {
        console.log("[RMB-ModelMove]", {
          dxPx,
          dyPx,
          delta: { x: +this._vDelta.x.toFixed(4), y: +this._vDelta.y.toFixed(4), z: +this._vDelta.z.toFixed(4) },
        });
      } catch (_) {}
    }
  }

  #handlePointerUp(e) {
    if (this._activePointerId == null) return;
    if (e && e.pointerId !== this._activePointerId) return;
    this.#stopDrag(e);
  }

  #stopDrag(e) {
    try { window.removeEventListener("pointermove", this._onPointerMove); } catch (_) {}
    try { window.removeEventListener("pointerup", this._onPointerUp); } catch (_) {}
    try { window.removeEventListener("pointercancel", this._onPointerUp); } catch (_) {}

    try {
      const controls = this.getControls?.();
      if (controls && this._prevControlsEnabled != null) controls.enabled = this._prevControlsEnabled;
    } catch (_) {}
    this._prevControlsEnabled = null;

    try {
      if (e && this.domElement.releasePointerCapture) this.domElement.releasePointerCapture(e.pointerId);
    } catch (_) {}

    this._activePointerId = null;
    // чуть задержим сброс, чтобы contextmenu не проскочил на mouseup
    setTimeout(() => { this._suppressContextMenu = false; }, 0);

    if (this.isDebug()) {
      try { console.log("[RMB-ModelMove] end"); } catch (_) {}
    }
  }
}


