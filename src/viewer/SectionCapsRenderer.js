import * as THREE from "three";

/**
 * Рисует "заглушку" (cap) для секущих плоскостей через stencil buffer.
 *
 * Идея: для каждой активной плоскости
 * 1) два прохода по модели (BackSide/FrontSide) с инкрементом/декрементом stencil
 * 2) рисуем большую плоскость на месте сечения с stencilFunc != 0
 *
 * Это закрывает "пустоту" в двухслойных стенах и убирает мерцание внутри.
 */
export class SectionCapsRenderer {
  /**
   * @param {{ color?: number }} options
   */
  constructor(options = {}) {
    this.color = options.color ?? 0x212121;

    /** @type {THREE.Scene} */
    this._capScene = new THREE.Scene();

    /** @type {THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>} */
    this._capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), this._createCapMaterial());
    this._capMesh.frustumCulled = false;
    this._capScene.add(this._capMesh);

    this._stencilBack = this._createStencilMaterial({
      side: THREE.BackSide,
      zOp: THREE.IncrementWrapStencilOp,
    });
    this._stencilFront = this._createStencilMaterial({
      side: THREE.FrontSide,
      zOp: THREE.DecrementWrapStencilOp,
    });

    this._tmp = {
      v0: new THREE.Vector3(),
      v1: new THREE.Vector3(),
      box: new THREE.Box3(),
      size: new THREE.Vector3(),
      center: new THREE.Vector3(),
    };

    this._warnedNoStencil = false;
  }

  /** @param {THREE.WebGLRenderer} renderer */
  _hasStencil(renderer) {
    try {
      const gl = renderer.getContext();
      const attrs = gl?.getContextAttributes?.();
      // В WebGL2/рендер-таргетах stencil может быть и при attrs.stencil=false,
      // но если attrs явно false — предупредим один раз, а дальше попытаемся всё равно.
      if (attrs && attrs.stencil === false && !this._warnedNoStencil) {
        this._warnedNoStencil = true;
        // eslint-disable-next-line no-console
        console.warn("[SectionCaps] WebGL context reports stencil=false; caps may not render. Consider enabling stencil in WebGLRenderer.");
      }
    } catch (_) {}
    return true;
  }

  _createStencilMaterial({ side, zOp }) {
    const m = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side,
      // ничего в цвет не пишем — только stencil
      colorWrite: false,
      depthWrite: false,
      depthTest: true,
    });
    m.stencilWrite = true;
    m.stencilRef = 0;
    m.stencilFunc = THREE.AlwaysStencilFunc;
    m.stencilFail = THREE.KeepStencilOp;
    m.stencilZFail = zOp;
    m.stencilZPass = zOp;
    // локальный клиппинг на материале
    m.clippingPlanes = null;
    m.clipIntersection = false;
    m.clipShadows = false;
    return m;
  }

  _createCapMaterial() {
    const m = new THREE.MeshBasicMaterial({
      color: this.color,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      transparent: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    m.stencilWrite = true;
    m.stencilRef = 0;
    m.stencilFunc = THREE.NotEqualStencilFunc;
    m.stencilFail = THREE.KeepStencilOp;
    m.stencilZFail = THREE.KeepStencilOp;
    m.stencilZPass = THREE.KeepStencilOp;
    m.stencilMask = 0xff;
    m.clippingPlanes = null; // задаём на кадр
    m.clipIntersection = false;
    m.clipShadows = false;
    return m;
  }

  /**
   * @param {{ obj: THREE.Object3D, root: THREE.Object3D }} args
   */
  _isInSubtree({ obj, root }) {
    let n = obj;
    while (n) {
      if (n === root) return true;
      n = n.parent;
    }
    return false;
  }

  /**
   * Обновляет положение/ориентацию "большой" плоскости cap.
   * @param {THREE.Plane} plane
   * @param {THREE.Object3D} subject
   */
  _updateCapMeshTransform(plane, subject) {
    const { box, size, v0, v1 } = this._tmp;
    box.setFromObject(subject);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const extent = Math.max(1e-3, maxDim * 2.2); // запас, stencil ограничит до контура среза

    // PlaneGeometry лежит в XY и смотрит в +Z
    v0.set(0, 0, 1);
    v1.copy(plane.normal).normalize();
    this._capMesh.quaternion.setFromUnitVectors(v0, v1);

    // точка на плоскости: p0 = -constant * normal
    this._capMesh.position.copy(plane.normal).multiplyScalar(-plane.constant);
    this._capMesh.scale.set(extent, extent, 1);
    this._capMesh.updateMatrixWorld(true);
  }

  /**
   * Рисует cap'ы в текущий render target (screen или буфер композера).
   *
   * @param {{
   *   renderer: THREE.WebGLRenderer,
   *   scene: THREE.Scene,
   *   camera: THREE.Camera,
   *   subject: THREE.Object3D | null,
   *   activePlanes: THREE.Plane[],
   * }} args
   */
  render({ renderer, scene, camera, subject, activePlanes }) {
    if (!renderer || !scene || !camera) return;
    if (!subject) return;
    if (!activePlanes || activePlanes.length === 0) return;
    this._hasStencil(renderer);

    // Спрячем все меши вне модели, чтобы stencil не "цеплял" землю/тень и прочее
    const hidden = [];
    try {
      scene.traverse((node) => {
        if (!node?.isMesh) return;
        if (this._isInSubtree({ obj: node, root: subject })) return;
        if (node.visible) {
          node.visible = false;
          hidden.push(node);
        }
      });
    } catch (_) {}

    const prevOverride = scene.overrideMaterial;
    const prevLocal = renderer.localClippingEnabled;
    const prevGlobalPlanes = renderer.clippingPlanes;

    // Важно: для материалов с local clipping нужно localClippingEnabled=true,
    // а глобальные renderer.clippingPlanes отключаем, чтобы cap не резало "самой собой".
    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = [];

    const gl = renderer.getContext();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    try {
      for (const p of activePlanes) {
        if (!p || !isFinite(p.constant)) continue;

        // Чистим stencil перед обработкой каждой плоскости
        try {
          gl.clearStencil(0);
          gl.clear(gl.STENCIL_BUFFER_BIT);
        } catch (_) {}

        // Stencil pass: back faces (+1)
        this._stencilBack.clippingPlanes = activePlanes;
        scene.overrideMaterial = this._stencilBack;
        renderer.render(scene, camera);

        // Stencil pass: front faces (-1)
        this._stencilFront.clippingPlanes = activePlanes;
        scene.overrideMaterial = this._stencilFront;
        renderer.render(scene, camera);

        // Cap plane: stencil != 0, и клиппинг только другими плоскостями (без текущей)
        const capMat = this._capMesh.material;
        capMat.color.setHex(this.color);
        capMat.clippingPlanes = activePlanes.filter((q) => q !== p);
        this._updateCapMeshTransform(p, subject);
        renderer.render(this._capScene, camera);
      }
    } finally {
      scene.overrideMaterial = prevOverride;
      renderer.localClippingEnabled = prevLocal;
      renderer.clippingPlanes = prevGlobalPlanes;
      renderer.autoClear = prevAutoClear;
      for (const n of hidden) n.visible = true;
    }
  }
}


