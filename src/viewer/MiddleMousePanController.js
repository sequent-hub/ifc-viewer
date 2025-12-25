import * as THREE from "three";

/**
 * Middle-mouse (MMB) pan controller.
 *
 * Цель: панорамирование "как в Autodesk" — сдвигать всю картинку (вид) при drag
 * средней кнопкой мыши (нажатое колесо), но НЕ менять pivot вращения (controls.target).
 *
 * Реализация: camera.setViewOffset(...) — экранное смещение проекции (off-axis).
 *
 * Важно:
 * - перехватывает события в capture-phase, чтобы OrbitControls не выполнял dolly на MMB
 * - не трогает поведение ЛКМ/ПКМ
 */
export class MiddleMousePanController {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.domElement
   * @param {() => (THREE.Camera|null)} deps.getCamera
   * @param {() => (import('three/examples/jsm/controls/OrbitControls').OrbitControls|null)} deps.getControls
   * @param {() => boolean} [deps.isEnabled]
   * @param {(e: PointerEvent) => boolean} [deps.shouldIgnoreEvent]
   * @param {() => boolean} [deps.isDebug]
   */
  constructor(deps) {
    this.domElement = deps.domElement;
    this.getCamera = deps.getCamera;
    this.getControls = deps.getControls;
    this.isEnabled = deps.isEnabled || (() => true);
    this.shouldIgnoreEvent = deps.shouldIgnoreEvent || (() => false);
    this.isDebug = deps.isDebug || (() => false);

    this._activePointerId = null;
    this._last = { x: 0, y: 0 };
    this._prevControlsEnabled = null;

    // Смещение вида в пикселях (screen-space)
    this._offsetPx = { x: 0, y: 0 };

    // Векторы оставлены только для возможных будущих расширений (не обязаны, но безопасно)
    this._tmp = new THREE.Vector2();

    /** @type {(e: PointerEvent) => void} */
    this._onPointerDown = (e) => this.#handlePointerDown(e);
    /** @type {(e: PointerEvent) => void} */
    this._onPointerMove = (e) => this.#handlePointerMove(e);
    /** @type {(e: PointerEvent) => void} */
    this._onPointerUp = (e) => this.#handlePointerUp(e);

    // Capture-phase: чтобы остановить OrbitControls (MMB по умолчанию = dolly)
    this.domElement.addEventListener("pointerdown", this._onPointerDown, { capture: true, passive: false });
  }

  /**
   * Сбрасывает MMB-pan смещение (возвращает вид как без viewOffset).
   * Используется Home-кнопкой.
   */
  reset() {
    this._offsetPx.x = 0;
    this._offsetPx.y = 0;
    const camera = this.getCamera?.();
    if (!camera) return;

    try {
      if (typeof camera.clearViewOffset === "function") {
        camera.clearViewOffset();
        camera.updateProjectionMatrix();
        return;
      }
    } catch (_) {}

    // Fallback: setViewOffset(…, 0,0, …) с текущим размером
    try {
      const rect = this.domElement.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      camera.setViewOffset(w, h, 0, 0, w, h);
      camera.updateProjectionMatrix();
    } catch (_) {}
  }

  /**
   * Переустанавливает текущий viewOffset (например, после resize / смены камеры).
   * @param {number} [width]
   * @param {number} [height]
   */
  applyCurrentOffset(width, height) {
    const camera = this.getCamera?.();
    if (!camera) return;
    let w = width, h = height;
    if (!(Number.isFinite(w) && Number.isFinite(h))) {
      const rect = this.domElement.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      w = rect.width;
      h = rect.height;
    }
    this.#applyViewOffset(camera, w, h);
  }

  dispose() {
    try {
      this.domElement.removeEventListener("pointerdown", this._onPointerDown, { capture: true });
    } catch (_) {
      try { this.domElement.removeEventListener("pointerdown", this._onPointerDown); } catch (_) {}
    }
    this.#stopDrag(null);
  }

  #handlePointerDown(e) {
    if (!this.isEnabled()) return;
    if (e.button !== 1) return; // MMB only
    if (this.shouldIgnoreEvent && this.shouldIgnoreEvent(e)) return;

    const camera = this.getCamera?.();
    const controls = this.getControls?.();
    if (!camera || !controls) return;

    // Заблокируем дефолт браузера (автоскролл) и OrbitControls dolly.
    e.preventDefault();
    e.stopPropagation();
    // eslint-disable-next-line no-undef
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    // Начинаем drag
    this._activePointerId = e.pointerId;
    this._last.x = e.clientX;
    this._last.y = e.clientY;

    // На время MMB-pan отключаем controls, чтобы не срабатывали внутренние обработчики
    try {
      this._prevControlsEnabled = !!controls.enabled;
      controls.enabled = false;
    } catch (_) {
      this._prevControlsEnabled = null;
    }

    try { this.domElement.setPointerCapture?.(e.pointerId); } catch (_) {}

    // Слушаем move/up на window — надёжно при уходе курсора за пределы канваса
    window.addEventListener("pointermove", this._onPointerMove, { passive: false });
    window.addEventListener("pointerup", this._onPointerUp, { passive: false });
    window.addEventListener("pointercancel", this._onPointerUp, { passive: false });

    if (this.isDebug()) {
      try { console.log("[MMB-Pan] start"); } catch (_) {}
    }
  }

  #handlePointerMove(e) {
    if (this._activePointerId == null) return;
    if (e.pointerId !== this._activePointerId) return;

    const camera = this.getCamera?.();
    if (!camera) return;

    const rect = this.domElement.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    // Заблокируем дефолт (на некоторых браузерах автоскролл может пытаться включиться)
    e.preventDefault();
    e.stopPropagation();
    // eslint-disable-next-line no-undef
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    const dxPx = e.clientX - this._last.x;
    const dyPx = e.clientY - this._last.y;
    if (dxPx === 0 && dyPx === 0) return;
    this._last.x = e.clientX;
    this._last.y = e.clientY;

    // Screen-space смещение: двигаем "картинку", pivot (controls.target) НЕ трогаем.
    // Подбор знака: drag вправо => объект на экране тоже уходит вправо (как "тащим" сцену рукой).
    // Интуитивное направление: "тащим" сцену рукой.
    // Если курсор уходит влево — картинка должна уйти влево (и наоборот).
    this._offsetPx.x -= dxPx;
    this._offsetPx.y -= dyPx;
    this.#applyViewOffset(camera, rect.width, rect.height);

    if (this.isDebug()) {
      try {
        console.log("[MMB-Pan]", {
          dxPx,
          dyPx,
          offsetPx: { x: this._offsetPx.x, y: this._offsetPx.y },
        });
      } catch (_) {}
    }
  }

  #applyViewOffset(camera, width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const ox = Math.round(this._offsetPx.x);
    const oy = Math.round(this._offsetPx.y);
    try {
      // fullWidth/fullHeight == width/height => off-axis shift (без "подматриц")
      camera.setViewOffset(w, h, ox, oy, w, h);
      camera.updateProjectionMatrix();
    } catch (_) {}
  }

  #handlePointerUp(e) {
    if (this._activePointerId == null) return;
    if (e && e.pointerId !== this._activePointerId) return;
    this.#stopDrag(e);
  }

  #stopDrag(e) {
    // Снимем window listeners
    try { window.removeEventListener("pointermove", this._onPointerMove); } catch (_) {}
    try { window.removeEventListener("pointerup", this._onPointerUp); } catch (_) {}
    try { window.removeEventListener("pointercancel", this._onPointerUp); } catch (_) {}

    // Восстановим OrbitControls
    try {
      const controls = this.getControls?.();
      if (controls && this._prevControlsEnabled != null) controls.enabled = this._prevControlsEnabled;
    } catch (_) {}
    this._prevControlsEnabled = null;

    // Освободим pointer capture
    try {
      if (e && this.domElement.releasePointerCapture) this.domElement.releasePointerCapture(e.pointerId);
    } catch (_) {}

    this._activePointerId = null;

    if (this.isDebug()) {
      try { console.log("[MMB-Pan] end"); } catch (_) {}
    }
  }
}


