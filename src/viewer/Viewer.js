// Класс Viewer инкапсулирует настройку three.js сцены
// Чистый JS, без фреймворков. Комментарии на русском.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

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

    this.handleResize = this.handleResize.bind(this);
    this.animate = this.animate.bind(this);
  }

  init() {
    if (!this.container) throw new Error("Viewer: контейнер не найден");

    // Рендерер
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.container.clientWidth || 300, this.container.clientHeight || 150);
    this.container.appendChild(this.renderer.domElement);

    // Сцена
    this.scene = new THREE.Scene();

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

    // Демонстрационный объект (куб)
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4, metalness: 0.1 });
    const cube = new THREE.Mesh(geometry, material);
    cube.name = "demo-cube";
    this.scene.add(cube);

    // Обработчик ресайза
    window.addEventListener("resize", this.handleResize);

    // Начальная подгонка размеров контейнера
    this.handleResize();

    // Старт цикла
    this.animate();
  }

  handleResize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    const cube = this.scene && this.scene.getObjectByName("demo-cube");
    if (cube) {
      cube.rotation.y += 0.01;
      cube.rotation.x += 0.005;
    }

    if (this.controls) this.controls.update();
    this._notifyZoomIfChanged();
    if (this.renderer && this.camera && this.scene) {
      this.renderer.render(this.scene, this.camera);
    }
    this.animationId = requestAnimationFrame(this.animate);
  }

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.handleResize);

    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
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
}


