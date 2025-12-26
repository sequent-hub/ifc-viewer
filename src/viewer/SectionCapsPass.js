import { Pass } from "three/examples/jsm/postprocessing/Pass.js";

/**
 * Pass для EffectComposer: рисует "cap" сечения поверх текущего буфера,
 * используя depth+stencil текущего renderTarget.
 */
export class SectionCapsPass extends Pass {
  /**
   * @param {{
   *  capsRenderer: { render(args: any): void },
   *  getScene: () => any,
   *  getCamera: () => any,
   *  getSubject: () => any,
   *  getActivePlanes: () => any[],
   * }} args
   */
  constructor({ capsRenderer, getScene, getCamera, getSubject, getActivePlanes }) {
    super();
    this._caps = capsRenderer;
    this._getScene = getScene;
    this._getCamera = getCamera;
    this._getSubject = getSubject;
    this._getActivePlanes = getActivePlanes;

    // Рисуем поверх readBuffer, swap не нужен
    this.needsSwap = false;
    this.clear = false;
    this.enabled = true;
  }

  // eslint-disable-next-line no-unused-vars
  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    if (!this.enabled) return;
    const scene = this._getScene?.();
    const camera = this._getCamera?.();
    const subject = this._getSubject?.();
    const planes = this._getActivePlanes?.() || [];
    const activePlanes = planes.filter((p) => p && isFinite(p.constant));
    if (!scene || !camera || !subject || activePlanes.length === 0) return;

    // Важно: рисуем в readBuffer (текущий буфер композера)
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this._caps.render({
      renderer,
      scene,
      camera,
      subject,
      activePlanes,
    });
  }
}


