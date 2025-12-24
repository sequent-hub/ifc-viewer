import * as THREE from "three";

/**
 * Zoom-to-cursor для three.js камер (Perspective + Orthographic).
 * Делает зум колёсиком относительно точки под курсором.
 *
 * Реализовано через:
 * - выбор "опорной плоскости" (hit по модели, иначе плоскость через target)
 * - изменение дистанции/zoom
 * - компенсацию сдвига (camera + controls.target), чтобы опорная точка оставалась под курсором
 */
export class ZoomToCursorController {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.domElement
   * @param {() => (THREE.Camera|null)} deps.getCamera
   * @param {() => (import('three/examples/jsm/controls/OrbitControls').OrbitControls|null)} deps.getControls
   * @param {() => (THREE.Object3D|null)} deps.getPickRoot
   * @param {(force?: boolean) => void} [deps.onZoomChanged]
   * @param {() => boolean} [deps.isEnabled]
   * @param {() => boolean} [deps.isDebug]
   */
  constructor(deps) {
    this.domElement = deps.domElement;
    this.getCamera = deps.getCamera;
    this.getControls = deps.getControls;
    this.getPickRoot = deps.getPickRoot;
    this.onZoomChanged = deps.onZoomChanged || null;
    this.isEnabled = deps.isEnabled || (() => true);
    this.isDebug = deps.isDebug || (() => false);

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane();

    this._vDir = new THREE.Vector3();
    this._vA = new THREE.Vector3();
    this._vB = new THREE.Vector3();
    this._vC = new THREE.Vector3();
    this._vBefore = new THREE.Vector3();
    this._vAfter = new THREE.Vector3();

    /** @type {(e: WheelEvent) => void} */
    this._onWheel = (e) => this.#handleWheel(e);
    this.domElement.addEventListener("wheel", this._onWheel, { capture: true, passive: false });
  }

  dispose() {
    try {
      this.domElement.removeEventListener("wheel", this._onWheel, { capture: true });
    } catch (_) {
      try {
        // fallback для браузеров/реализаций, которые игнорируют options при remove
        this.domElement.removeEventListener("wheel", this._onWheel);
      } catch (_) {}
    }
  }

  #handleWheel(e) {
    if (!this.isEnabled()) return;
    const camera = this.getCamera?.();
    const controls = this.getControls?.();
    if (!camera || !controls) return;

    // Предотвратить скролл страницы и работу OrbitControls (у него свой wheel listener)
    e.preventDefault();
    e.stopPropagation();
    // eslint-disable-next-line no-undef
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    const rect = this.domElement.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    // --- NDC курсора ---
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this._ndc.set(x, y);

    // --- нормализуем deltaY для разных режимов прокрутки ---
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;     // lines -> px (примерно)
    else if (e.deltaMode === 2) dy *= 100; // pages -> px (грубо)

    const zoomSpeed = Number(controls.zoomSpeed ?? 1);
    const speed = Number.isFinite(zoomSpeed) ? zoomSpeed : 1;
    // scale > 1 => zoom out, scale < 1 => zoom in
    let scale = Math.exp(dy * 0.002 * speed);
    // защита от экстремальных значений
    scale = Math.min(5, Math.max(0.2, scale));

    // --- Опорная плоскость: hit по модели, иначе плоскость через target ---
    // ВАЖНО: для "пролёта" внутрь здания нам нельзя зависеть от ближайшей стены.
    // Поэтому при попытке приблизиться дальше minDistance мы используем target-plane,
    // а "излишек" приближения превращаем в поступательное движение вперёд (camera+target).
    const pickRoot = this.getPickRoot?.();
    let anchor = null;
    let source = "target-plane";
    const flyMinEps = 1e-6;

    // Определим, упёрлись ли мы в minDistance и пытаемся приблизиться ещё
    let distToTargetNow = null;
    let minDNow = null;
    let wantFlyForward = false;
    if (camera.isPerspectiveCamera) {
      distToTargetNow = camera.position.distanceTo(controls.target);
      minDNow = controls.minDistance || 0.01;
      // scale < 1 => приближение
      const desired = distToTargetNow * scale;
      wantFlyForward = scale < 1 && desired < (minDNow - flyMinEps);
    }

    // 1) пробуем попадание по модели (только если не в режиме fly-forward)
    if (pickRoot && !wantFlyForward) {
      this._raycaster.setFromCamera(this._ndc, camera);
      const hits = this._raycaster.intersectObject(pickRoot, true);
      if (hits && hits.length > 0 && hits[0] && hits[0].point) {
        anchor = this._vA.copy(hits[0].point);
        source = "model-hit";
      }
    }

    // 2) если по модели не попали — используем target как точку на плоскости
    if (!anchor) {
      anchor = this._vA.copy(controls.target);
      if (wantFlyForward) source = "fly-target";
    }

    // Для корректной диагностики проекций/лучей обновим матрицы (не меняет поведения)
    try { camera.updateMatrixWorld?.(true); } catch (_) {}

    // Плоскость перпендикулярна направлению взгляда.
    // ВАЖНО: при сильном приближении камера может "пересечь" плоскость через anchor,
    // и ray.intersectPlane() начнёт возвращать null (пересечение "позади" луча),
    // что раньше полностью "останавливало" зум. Поэтому:
    // - сначала пробуем anchor-plane
    // - если не получилось — переключаемся на fallback-plane перед камерой
    // - если всё равно не получилось — продолжаем зум БЕЗ cursor-компенсации (но зум не замирает)
    camera.getWorldDirection(this._vDir).normalize();
    let planeKind = "anchor-plane";
    this._plane.setFromNormalAndCoplanarPoint(this._vDir, anchor);

    // Точка под курсором ДО зума (пересечение луча курсора с плоскостью)
    this._raycaster.setFromCamera(this._ndc, camera);
    let okBefore = this._raycaster.ray.intersectPlane(this._plane, this._vBefore);

    if (!okBefore) {
      // Fallback-plane: гарантированно "перед" камерой по направлению взгляда
      planeKind = "camera-plane";
      const distToTarget = camera.position.distanceTo(controls.target);
      const depth = Math.max(0.01, (camera.near || 0.01) * 2, distToTarget);
      const p = this._vC.copy(camera.position).add(this._vB.copy(this._vDir).multiplyScalar(depth));
      this._plane.setFromNormalAndCoplanarPoint(this._vDir, p);
      okBefore = this._raycaster.ray.intersectPlane(this._plane, this._vBefore);
    }

    const canCompensate = !!okBefore;

    // Диагностика: посчитаем дрейф anchor в пикселях (до/после) — то, что вы визуально наблюдаете
    let debugPayload = null;
    if (this.isDebug()) {
      const anchorNdc0 = this._vB.copy(anchor).project(camera);
      const driftPx0 = {
        dx: (anchorNdc0.x - this._ndc.x) * (rect.width / 2),
        dy: (anchorNdc0.y - this._ndc.y) * (rect.height / 2),
      };
      debugPayload = {
        src: source,
        mode: camera.isOrthographicCamera ? "ortho" : "perspective",
        plane: planeKind,
        canCompensate,
        dy,
        scale: +scale.toFixed(4),
        cursorNdc: { x: +this._ndc.x.toFixed(4), y: +this._ndc.y.toFixed(4) },
        anchorWorld: { x: +anchor.x.toFixed(3), y: +anchor.y.toFixed(3), z: +anchor.z.toFixed(3) },
        anchorNdcBefore: { x: +anchorNdc0.x.toFixed(4), y: +anchorNdc0.y.toFixed(4), z: +anchorNdc0.z.toFixed(4) },
        anchorDriftPxBefore: { dx: +driftPx0.dx.toFixed(2), dy: +driftPx0.dy.toFixed(2) },
        viewDir: { x: +this._vDir.x.toFixed(4), y: +this._vDir.y.toFixed(4), z: +this._vDir.z.toFixed(4) },
        rayDir: {
          x: +this._raycaster.ray.direction.x.toFixed(4),
          y: +this._raycaster.ray.direction.y.toFixed(4),
          z: +this._raycaster.ray.direction.z.toFixed(4),
        },
        camPosBefore: {
          x: +camera.position.x.toFixed(3),
          y: +camera.position.y.toFixed(3),
          z: +camera.position.z.toFixed(3),
        },
        targetBefore: {
          x: +controls.target.x.toFixed(3),
          y: +controls.target.y.toFixed(3),
          z: +controls.target.z.toFixed(3),
        },
      };
    }

    const t0 = this.isDebug() ? performance.now() : 0;

    // --- Применяем зум ---
    if (camera.isOrthographicCamera) {
      const minZ = controls.minZoom ?? 0.01;
      const maxZ = controls.maxZoom ?? 100;
      const curr = camera.zoom || 1;
      const next = curr / scale; // scale>1 => zoom out (уменьшаем zoom)
      camera.zoom = Math.min(Math.max(next, minZ), maxZ);
      camera.updateProjectionMatrix();
    } else {
      const target = controls.target;
      const camPos = camera.position;
      const dir = this._vB.copy(camPos).sub(target).normalize(); // от target к камере
      const dist = camPos.distanceTo(target);
      const minD = controls.minDistance || 0.01;
      const maxD = controls.maxDistance || Infinity;
      const desiredDist = dist * scale; // scale>1 => zoom out (увеличиваем дистанцию), scale<1 => zoom in
      let nextDist = Math.min(Math.max(desiredDist, minD), maxD);

      // Базовый dolly до minDistance
      camPos.copy(this._vC.copy(target).add(dir.multiplyScalar(nextDist)));

      // Fly-through: преднамеренный "пролёт" дальше minDistance (только на zoom-in)
      // Излишек приближения превращаем в движение вперёд (camera+target) вдоль направления взгляда.
      // Это снимает "упор" в minDistance и позволяет проходить через стены/внутрь помещений.
      if (scale < 1 && desiredDist < minD - flyMinEps) {
        const forward = this._vC.copy(target).sub(camPos).normalize(); // от камеры к target
        const leftover = (minD - desiredDist);
        // Сдвигаем и камеру, и target: дистанция остаётся minD, но мы "летим" вперёд
        camPos.add(this._vA.copy(forward).multiplyScalar(leftover));
        target.add(this._vA.copy(forward).multiplyScalar(leftover));
        camera.updateProjectionMatrix();
      }
      camera.updateProjectionMatrix();
    }

    // Матрицы могли устареть после изменения позиции/zoom
    try { camera.updateMatrixWorld?.(true); } catch (_) {}

    // --- Компенсация: чтобы точка на плоскости осталась под курсором ---
    let didCompensate = false;
    if (canCompensate) {
      this._raycaster.setFromCamera(this._ndc, camera);
      const okAfter = this._raycaster.ray.intersectPlane(this._plane, this._vAfter);
      if (okAfter) {
        const delta = this._vC.copy(this._vBefore).sub(this._vAfter);
        camera.position.add(delta);
        controls.target.add(delta);
        didCompensate = true;
      } else {
        // Нельзя компенсировать на этом шаге (например, камера пересекла плоскость) —
        // но зум уже применён, поэтому не останавливаемся.
        didCompensate = false;
      }
    }

    controls.update();
    if (this.onZoomChanged) this.onZoomChanged(true);

    if (this.isDebug()) {
      const ms = performance.now() - t0;
      const anchorNdc1 = this._vB.copy(anchor).project(camera);
      const driftPx1 = {
        dx: (anchorNdc1.x - this._ndc.x) * (rect.width / 2),
        dy: (anchorNdc1.y - this._ndc.y) * (rect.height / 2),
      };
      const out = debugPayload || {};
      out.dtMs = +ms.toFixed(2);
      out.didCompensate = didCompensate;
      out.anchorNdcAfter = { x: +anchorNdc1.x.toFixed(4), y: +anchorNdc1.y.toFixed(4), z: +anchorNdc1.z.toFixed(4) };
      out.anchorDriftPxAfter = { dx: +driftPx1.dx.toFixed(2), dy: +driftPx1.dy.toFixed(2) };
      out.camPosAfter = {
        x: +camera.position.x.toFixed(3),
        y: +camera.position.y.toFixed(3),
        z: +camera.position.z.toFixed(3),
      };
      out.targetAfter = {
        x: +controls.target.x.toFixed(3),
        y: +controls.target.y.toFixed(3),
        z: +controls.target.z.toFixed(3),
      };
      out.zoom = camera.isOrthographicCamera ? +(camera.zoom || 1).toFixed(4) : null;
      // eslint-disable-next-line no-console
      console.log("[ZoomToCursor]", out);
    }
  }
}


