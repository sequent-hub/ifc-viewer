import * as THREE from "three";

class CardMarker {
  /**
   * @param {object} deps
   * @param {number} deps.id
   * @param {THREE.Vector3} deps.localPoint
   * @param {HTMLElement} deps.el
   */
  constructor(deps) {
    this.id = deps.id;
    this.localPoint = deps.localPoint;
    this.el = deps.el;
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
    this._raf = 0;

    this._controlsWasEnabled = null;

    this._ui = this.#createUi();
    this.#attachUi();
    this.#bindEvents();
    this.#startRaf();
  }

  dispose() {
    try { this.cancelPlacement(); } catch (_) {}

    const dom = this.viewer?.renderer?.domElement;
    try { dom?.removeEventListener("pointermove", this._onPointerMove); } catch (_) {}
    try { dom?.removeEventListener("pointerdown", this._onPointerDownCapture, { capture: true }); } catch (_) {
      try { dom?.removeEventListener("pointerdown", this._onPointerDownCapture); } catch (_) {}
    }
    try { window.removeEventListener("keydown", this._onKeyDown); } catch (_) {}
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

  #createUi() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ifc-card-add-btn";
    btn.textContent = "+ Добавить карточку";

    const ghost = document.createElement("div");
    ghost.className = "ifc-card-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.display = "none";

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

    const dom = this.viewer?.renderer?.domElement;
    if (!dom) return;

    this._onPointerMove = (e) => {
      if (!this._placing) return;
      this._lastPointer = { x: e.clientX, y: e.clientY };
      this.#syncGhost();
    };
    dom.addEventListener("pointermove", this._onPointerMove, { passive: true });

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

  #syncGhost() {
    const g = this._ui?.ghost;
    if (!g) return;
    this._ui.num.textContent = String(this._nextId);
    // Призрак “у курсора”: небольшой сдвиг, чтобы не перекрывать точку клика
    const x = this._lastPointer.x + 12;
    const y = this._lastPointer.y + 12;
    g.style.left = `${x}px`;
    g.style.top = `${y}px`;
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
    this.container.appendChild(el);

    // Храним локальную координату модели, чтобы метка оставалась “приклеенной” к модели
    this._tmpLocal.copy(hit.point);
    model.worldToLocal(this._tmpLocal);

    const marker = new CardMarker({
      id,
      localPoint: this._tmpLocal.clone(),
      el,
    });
    this._markers.push(marker);

    this.#log("placed", {
      id,
      local: { x: +marker.localPoint.x.toFixed(4), y: +marker.localPoint.y.toFixed(4), z: +marker.localPoint.z.toFixed(4) },
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
      m.el.style.left = `${x}px`;
      m.el.style.top = `${y}px`;
    }
  }
}

