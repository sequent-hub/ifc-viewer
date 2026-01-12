/**
 * ModelLoaderRegistry
 * Central registry for model loaders (IFC/FBX/...) with a stable API.
 *
 * Design goals:
 * - Open/Closed: add new formats by registering a loader, without touching UI code.
 * - Single Responsibility: registry selects loader + orchestrates loading + optional viewer integration.
 *
 * Loader contract (duck-typing, documented via JSDoc):
 * - loader.id: string (e.g. "ifc", "fbx")
 * - loader.extensions: string[] (lowercase, with leading dot, e.g. [".ifc",".ifczip"])
 * - loader.loadFile(file, ctx): Promise<LoadResult>
 * - loader.loadUrl(url, ctx): Promise<LoadResult>
 *
 * LoadResult:
 * - object3D: THREE.Object3D (required)
 * - format: string (loader id)
 * - name: string (file name or URL)
 * - capabilities?: object (optional, format-specific)
 * - replacedInViewer?: boolean (optional, true if loader already called viewer.replaceWithModel)
 */
export class ModelLoaderRegistry {
  constructor() {
    /** @type {Array<any>} */
    this._loaders = [];
  }

  /**
   * @param {any} loader
   * @returns {ModelLoaderRegistry}
   */
  register(loader) {
    if (!loader || typeof loader !== 'object') {
      throw new Error('ModelLoaderRegistry.register: loader must be an object');
    }
    if (!loader.id || typeof loader.id !== 'string') {
      throw new Error('ModelLoaderRegistry.register: loader.id must be a string');
    }
    if (!Array.isArray(loader.extensions) || loader.extensions.some((x) => typeof x !== 'string')) {
      throw new Error(`ModelLoaderRegistry.register: loader.extensions must be string[] (${loader.id})`);
    }
    if (typeof loader.loadFile !== 'function' && typeof loader.loadUrl !== 'function') {
      throw new Error(`ModelLoaderRegistry.register: loader must implement loadFile and/or loadUrl (${loader.id})`);
    }
    this._loaders.push(loader);
    return this;
  }

  /**
   * @returns {string[]} unique extensions (lowercase) like [".ifc",".fbx"]
   */
  getAllExtensions() {
    const out = new Set();
    for (const l of this._loaders) {
      for (const ext of (l.extensions || [])) out.add(String(ext).toLowerCase());
    }
    return Array.from(out).sort();
  }

  /**
   * @returns {string} accept string for <input type="file" accept="...">
   */
  getAcceptString() {
    const exts = this.getAllExtensions();
    return exts.length ? exts.join(',') : '';
  }

  /**
   * @param {string} nameOrUrl
   * @returns {any|null} loader
   */
  getLoaderForName(nameOrUrl) {
    const s = String(nameOrUrl || '').toLowerCase();
    if (!s) return null;
    // Prefer longest extension match (e.g. ".ifczip" over ".zip")
    let best = null;
    let bestLen = -1;
    for (const l of this._loaders) {
      for (const ext of (l.extensions || [])) {
        const e = String(ext).toLowerCase();
        if (!e || !e.startsWith('.')) continue;
        if (s.endsWith(e) && e.length > bestLen) {
          best = l;
          bestLen = e.length;
        }
      }
    }
    return best;
  }

  /**
   * Loads a model from File and (optionally) integrates into viewer.
   *
   * @param {File} file
   * @param {{ viewer?: any, logger?: any }} [ctx]
   * @returns {Promise<any|null>} LoadResult or null on error
   */
  async loadFile(file, ctx = {}) {
    const name = file?.name || '';
    const loader = this.getLoaderForName(name);
    if (!loader) {
      throw new Error(`Формат не поддерживается: ${name || 'unknown file'}`);
    }

    const logger = ctx?.logger || console;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    try {
      logger?.log?.('[ModelLoaderRegistry] loadFile', { name, loader: loader.id });
      const result = await loader.loadFile(file, ctx);
      this._validateResult(result, loader.id);

      this._maybeReplaceInViewer(result, ctx);
      this._logResultSummary(result, t0, logger);
      return result;
    } catch (e) {
      logger?.error?.('[ModelLoaderRegistry] loadFile error', { name, loader: loader.id, error: e });
      throw e;
    }
  }

  /**
   * Loads a model from URL and (optionally) integrates into viewer.
   *
   * @param {string} url
   * @param {{ viewer?: any, logger?: any }} [ctx]
   * @returns {Promise<any|null>} LoadResult or null on error
   */
  async loadUrl(url, ctx = {}) {
    const loader = this.getLoaderForName(url);
    if (!loader) {
      throw new Error(`Формат не поддерживается: ${url || 'unknown url'}`);
    }

    const logger = ctx?.logger || console;
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    try {
      logger?.log?.('[ModelLoaderRegistry] loadUrl', { url, loader: loader.id });
      const result = await loader.loadUrl(url, ctx);
      this._validateResult(result, loader.id);

      this._maybeReplaceInViewer(result, ctx);
      this._logResultSummary(result, t0, logger);
      return result;
    } catch (e) {
      logger?.error?.('[ModelLoaderRegistry] loadUrl error', { url, loader: loader.id, error: e });
      throw e;
    }
  }

  _validateResult(result, loaderId) {
    if (!result || typeof result !== 'object') {
      throw new Error(`Loader "${loaderId}" returned invalid result`);
    }
    if (!result.object3D) {
      throw new Error(`Loader "${loaderId}" returned result without object3D`);
    }
    if (!result.format) result.format = loaderId;
    if (!result.name) result.name = '';
  }

  _maybeReplaceInViewer(result, ctx) {
    if (result?.replacedInViewer) return;
    const viewer = ctx?.viewer;
    if (!viewer || typeof viewer.replaceWithModel !== 'function') return;
    try {
      viewer.replaceWithModel(result.object3D);
    } catch (e) {
      const logger = ctx?.logger || console;
      logger?.warn?.('[ModelLoaderRegistry] viewer.replaceWithModel failed', e);
    }
  }

  _logResultSummary(result, t0, logger) {
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const ms = Math.round((t1 - t0) * 10) / 10;
    const obj = result?.object3D;
    const summary = {
      format: result?.format,
      name: result?.name,
      ms,
      object3D: obj ? { type: obj.type, children: Array.isArray(obj.children) ? obj.children.length : undefined } : null,
    };
    logger?.log?.('[ModelLoaderRegistry] loaded', summary);
  }
}

