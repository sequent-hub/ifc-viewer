import * as THREE from "three";

/**
 * Класс SectionManipulator отвечает за визуализацию и интерактив
 * одной секущей плоскости: квадрата-подсветки и стрелки, за
 * которую можно тянуть, перемещая плоскость вдоль её нормали.
 *
 * ООП: класс инкапсулирует собственные объекты сцены и обработчики.
 * Внешний мир управляет только включением/позиционированием через Plane
 * и вызывает update().
 */
export class SectionManipulator {
  /**
   * @param {Object} opts
   * @param {THREE.Scene} opts.scene - сцена, куда добавлять гизмо
   * @param {THREE.Camera} opts.camera - активная камера
   * @param {import('three/examples/jsm/controls/OrbitControls').OrbitControls} opts.controls - OrbitControls
   * @param {HTMLElement} opts.domElement - DOM-элемент канваса для событий
   * @param {THREE.Plane} opts.plane - глобальная плоскость отсечения (shared)
   * @param {'x'|'y'|'z'} opts.axis - ось секущей плоскости
   */
  constructor({ scene, camera, controls, domElement, plane, axis }) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.domElement = domElement;
    this.plane = plane;
    this.axis = axis;

    // Визуальные элементы
    this.root = new THREE.Group();
    this.root.name = `section-manipulator-${axis}`;
    this.root.visible = false;
    this.scene.add(this.root);

    // Рамка (без заливки) визуализации плоскости
    this.planeQuad = this.#createPlaneFrame();
    this.root.add(this.planeQuad);

    // Стрелка и хит-ручка
    const { arrow, handle } = this.#createArrowWithHandle();
    this.arrow = arrow;
    this.handle = handle;
    this.root.add(this.arrow);
    this.root.add(this.handle);

    // Луч и вспомогательные объекты для drag
    this.raycaster = new THREE.Raycaster();
    this.isDragging = false;
    this.dragData = null; // { startDistance, startHitPoint: Vector3, dragPlane: THREE.Plane }

    // Слушатели событий
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
  }

  /** Освобождение ресурсов и слушателей */
  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    // Удаляем из сцены и чистим геом/материалы
    const cleanup = (obj) => {
      obj.traverse?.((node) => {
        if (node.geometry?.dispose) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach((m) => m?.dispose && m.dispose());
          else if (node.material.dispose) node.material.dispose();
        }
      });
      if (obj.parent) obj.parent.remove(obj);
    };
    cleanup(this.root);
  }

  /** Включает/выключает видимость манипулятора */
  setEnabled(enabled) {
    this.root.visible = !!enabled;
  }

  /**
   * Обновляет позицию/ориентацию/масштаб в зависимости от плоскости и модели
   * @param {THREE.Object3D|null} subject - активная модель для расчёта размеров и направления стрелки
   */
  update(subject) {
    if (!this.root.visible || !isFinite(this.plane.constant)) return;

    // Позиция центра плоскости вдоль нормали: d = -constant
    const distance = -this.plane.constant;
    const normal = this.plane.normal.clone().normalize();
    this.root.position.copy(normal).multiplyScalar(distance);

    // Ориентация рамки и стрелки: ось Z гизмо смотрит вдоль нормали плоскости
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.root.setRotationFromQuaternion(q);

    // Масштаб под габариты модели
    let sceneScale = 1;
    if (subject) {
      const box = new THREE.Box3().setFromObject(subject);
      const size = box.getSize(new THREE.Vector3());
      sceneScale = Math.max(size.x, size.y, size.z, 1) * 1.2;
    }
    const quadScale = sceneScale / 100; // базовая геометрия 100x100
    this.planeQuad.scale.setScalar(quadScale);

    // Стрелка на стороне камеры (между камерой и плоскостью), направлена от объекта (наружу)
    const arrowLength = Math.max(sceneScale * 0.12, 0.2);
    const signedCam = this.plane.normal.dot(this.camera.position) + this.plane.constant;
    const localSign = signedCam > 0 ? 1 : -1; // +Z если камера на положительной стороне, иначе -Z
    const localDir = new THREE.Vector3(0, 0, localSign);
    this.#setArrowDirectionAndLength(localDir, arrowLength);

    // Позиция стрелки: ближе к камере, чуть отступив от плоскости
    const offset = Math.max(arrowLength * 0.8, 0.1);
    const arrowBase = localDir.clone().multiplyScalar(offset);
    this.arrow.position.copy(arrowBase);

    // Хит-цилиндр: центр по середине стрелки, длина покрывает всю стрелку
    const hitRadius = Math.max(sceneScale * 0.03, 0.1);
    const handleLen = arrowLength * 1.4; // чуть длиннее стрелки
    const handleCenter = arrowBase.clone().add(localDir.clone().multiplyScalar(arrowLength * 0.5));
    this.handle.position.copy(handleCenter);
    this.#orientHandleToDirection(localDir, 1);
    const baseRadius = 0.06;
    const rScale = hitRadius / baseRadius;
    this.handle.scale.set(rScale, handleLen, rScale);
  }

  // --- Внутренние методы визуальных элементов ---
  #createPlaneFrame() {
    const geom = new THREE.PlaneGeometry(100, 100);
    const edgesGeom = new THREE.EdgesGeometry(geom, 1);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xff0055,
      depthTest: false,
      transparent: true,
      opacity: 1,
      clippingPlanes: [],
    });
    const lines = new THREE.LineSegments(edgesGeom, lineMat);
    lines.name = `section-frame-${this.axis}`;
    lines.renderOrder = 999;
    return lines;
  }

  #createArrowWithHandle() {
    // Стрелка из ArrowHelper
    const dir = new THREE.Vector3(0, 0, 1);
    const length = 1;
    const color = 0xff0055;
    const headLength = 0.3;
    const headWidth = 0.15;
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), length, color, headLength, headWidth);
    arrow.line.material = new THREE.LineBasicMaterial({ color, depthTest: false, clippingPlanes: [] });
    if (arrow.cone?.material) {
      arrow.cone.material = new THREE.MeshBasicMaterial({ color, depthTest: false, clippingPlanes: [] });
    }
    arrow.renderOrder = 1000;
    arrow.name = `section-arrow-${this.axis}`;

    // Невидимый цилиндр для удобного попадания лучом
    const cylGeom = new THREE.CylinderGeometry(0.06, 0.06, 1, 16);
    const cylMat = new THREE.MeshBasicMaterial({ visible: false, depthTest: false });
    const handle = new THREE.Mesh(cylGeom, cylMat);
    handle.name = `section-handle-${this.axis}`;
    handle.userData.__isSectionHandle = true;

    return { arrow, handle };
  }

  #setArrowDirectionAndLength(direction, length) {
    const origin = new THREE.Vector3(0, 0, 0);
    const dirNorm = direction.clone().normalize();
    this.arrow.setDirection(dirNorm);
    this.arrow.setLength(length, Math.min(length * 0.5, 0.5 * length), Math.min(length * 0.25, 0.25 * length));
  }

  #orientHandleToDirection(direction, _lengthIgnored) {
    // Ориентируем цилиндр вдоль direction с центром в позиции handle
    const quat = new THREE.Quaternion();
    quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    this.handle.quaternion.copy(quat);
  }

  // --- Drag обработчики ---
  _onPointerDown(e) {
    if (!this.root.visible) return;
    const hit = this.#intersectPointerWithHandle(e);
    if (!hit) return;

    // Блокируем дефолт и начинаем перетаскивание
    e.preventDefault();
    try { this.domElement.setPointerCapture?.(e.pointerId); } catch(_) {}

    this.isDragging = true;
    this.controls && (this.controls.enabled = false);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp, { once: true });

    const normal = this.plane.normal.clone().normalize();
    const distance = -this.plane.constant; // текущее d вдоль нормали
    const planePoint = normal.clone().multiplyScalar(distance);

    const viewDir = new THREE.Vector3();
    this.camera.getWorldDirection(viewDir).normalize();
    // Вспомогательная плоскость перпендикулярна взгляду и проходит через planePoint
    const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, planePoint);

    const startHitPoint = this.#raycastToPlane(e, dragPlane) || planePoint.clone();
    this.dragData = { startDistance: distance, startHitPoint, dragPlane };
  }

  _onPointerMove(e) {
    if (!this.isDragging || !this.dragData) return;
    const { startDistance, startHitPoint, dragPlane } = this.dragData;
    const hit = this.#raycastToPlane(e, dragPlane);
    if (!hit) return;

    const normal = this.plane.normal.clone().normalize();
    const deltaVec = hit.clone().sub(startHitPoint);
    const delta = deltaVec.dot(normal); // проекция смещения на нормаль
    const newDistance = startDistance + delta;

    // Обновляем константу плоскости и визуализацию
    this.plane.constant = -newDistance;
  }

  _onPointerUp(e) {
    this.isDragging = false;
    this.dragData = null;
    window.removeEventListener('pointermove', this._onPointerMove);
    this.controls && (this.controls.enabled = true);
    try { this.domElement.releasePointerCapture?.(e.pointerId); } catch(_) {}
  }

  // --- Лучевые помощники ---
  #intersectPointerWithHandle(e) {
    const rect = this.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera({ x, y }, this.camera);
    const intersects = this.raycaster.intersectObject(this.handle, true);
    return intersects && intersects.length > 0 ? intersects[0] : null;
  }

  #raycastToPlane(e, plane) {
    const rect = this.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera({ x, y }, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }
}


