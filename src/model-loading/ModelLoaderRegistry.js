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
 * - loader.associatedExtensions?: string[] (optional; affects accept= only, not loader selection)
 * - loader.loadFile(file, ctx): Promise<LoadResult>
 * - loader.loadFiles?(files, ctx): Promise<LoadResult> (optional, for multi-file cases like OBJ+MTL)
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
      for (const ext of (l.associatedExtensions || [])) out.add(String(ext).toLowerCase());
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
   * Loads a model from multiple selected files (e.g. .obj + .mtl + textures).
   *
   * Rules:
   * - Choose ONE "primary" model file among the selection by best extension match.
   * - Pass all selected files to loader via ctx.files.
   * - If the chosen loader supports loadFiles(), it will be used; otherwise falls back to loadFile(primary).
   *
   * @param {File[]|FileList} files
   * @param {{ viewer?: any, logger?: any }} [ctx]
   */
  async loadFiles(files, ctx = {}) {
    const arr = Array.from(files || []).filter(Boolean);
    const logger = ctx?.logger || console;
    if (!arr.length) throw new Error('Нет выбранных файлов');

    // Find best primary file among selection
    let best = null;
    let bestLoader = null;
    let bestLen = -1;

    for (const f of arr) {
      const name = f?.name || '';
      const l = this.getLoaderForName(name);
      if (!l) continue;
      // score: longest extension match
      const lower = name.toLowerCase();
      for (const ext of (l.extensions || [])) {
        const e = String(ext).toLowerCase();
        if (e && lower.endsWith(e) && e.length > bestLen) {
          best = f;
          bestLoader = l;
          bestLen = e.length;
        }
      }
    }

    if (!best || !bestLoader) {
      throw new Error(`Формат не поддерживается: ${arr.map((f) => f?.name).filter(Boolean).join(', ')}`);
    }

    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const names = arr.map((f) => f?.name).filter(Boolean);

    try {
      logger?.log?.('[ModelLoaderRegistry] loadFiles', { primary: best.name, loader: bestLoader.id, files: names });
      const nextCtx = { ...ctx, files: arr };
      const result = (typeof bestLoader.loadFiles === 'function')
        ? await bestLoader.loadFiles(arr, nextCtx)
        : await bestLoader.loadFile(best, nextCtx);

      this._validateResult(result, bestLoader.id);
      this._maybeReplaceInViewer(result, ctx);
      this._logResultSummary(result, t0, logger);
      return result;
    } catch (e) {
      logger?.error?.('[ModelLoaderRegistry] loadFiles error', { primary: best.name, loader: bestLoader.id, files: names, error: e });
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
    const logger = ctx?.logger || console;
    let loader = this.getLoaderForName(url);

    // If URL doesn't contain an extension, try to infer format via headers/signature.
    // This is required for CDN-style links like /ifc-files/<id> (no ".ifc" suffix).
    if (!loader) {
      try {
        loader = await this._guessLoaderForUrl(url, logger);
      } catch (e) {
        logger?.warn?.('[ModelLoaderRegistry] url sniff failed', { url, error: e });
        loader = null;
      }
    }

    if (!loader) {
      throw new Error(`Формат не поддерживается: ${url || 'unknown url'}`);
    }

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

  /**
   * Tries to infer loader for URL without extension.
   *
   * Strategy:
   * - Use Content-Disposition filename (if present) to resolve extension
   * - Else sniff the first bytes (streaming) and match known signatures
   *
   * @param {string} url
   * @param {any} logger
   * @returns {Promise<any|null>}
   */
  async _guessLoaderForUrl(url, logger) {
    const u = String(url || '');
    if (!u) return null;

    // 1) Try HEAD headers (may expose filename and/or content-type)
    try {
      if (typeof fetch === 'function') {
        const head = await fetch(u, { method: 'HEAD' });
        const cd = head?.headers?.get?.('content-disposition') || head?.headers?.get?.('Content-Disposition');
        if (cd) {
          const fileName = this._tryParseFilenameFromContentDisposition(cd);
          if (fileName) {
            const byName = this.getLoaderForName(fileName);
            if (byName) {
              logger?.log?.('[ModelLoaderRegistry] url sniff: Content-Disposition matched', { url: u, fileName, loader: byName.id });
              return byName;
            }
          }
        }
        const ct = head?.headers?.get?.('content-type') || head?.headers?.get?.('Content-Type');
        // Content-Type is often "application/octet-stream", but keep a couple of strong signals.
        if (ct) {
          const lower = String(ct).toLowerCase();
          if (lower.includes('model/gltf-binary') || lower.includes('model/gltf+json')) {
            const byCt = this.getLoaderForName(lower.includes('binary') ? 'model.glb' : 'model.gltf');
            if (byCt) {
              logger?.log?.('[ModelLoaderRegistry] url sniff: Content-Type matched', { url: u, contentType: ct, loader: byCt.id });
              return byCt;
            }
          }
        }
      }
    } catch (_) {
      // ignore HEAD failures, proceed to signature sniff
    }

    // 2) Sniff first bytes (prefer Range; fall back to stream+abort)
    const prefix = await this._readUrlPrefix(u, 4096);
    if (!prefix || !prefix.length) return null;

    const sig = this._detectSignature(prefix);
    if (!sig) return null;

    const virtualName = sig.virtualName;
    const bySig = this.getLoaderForName(virtualName);
    if (bySig) {
      logger?.log?.('[ModelLoaderRegistry] url sniff: signature matched', { url: u, signature: sig.kind, virtualName, loader: bySig.id });
      return bySig;
    }

    return null;
  }

  _tryParseFilenameFromContentDisposition(cd) {
    try {
      const s = String(cd || '');
      // filename*=UTF-8''... (RFC 5987)
      const mStar = s.match(/filename\*\s*=\s*([^;]+)/i);
      if (mStar) {
        const v = mStar[1].trim();
        const parts = v.split("''");
        const encoded = parts.length >= 2 ? parts.slice(1).join("''") : v;
        const cleaned = encoded.replace(/^["']|["']$/g, '');
        try { return decodeURIComponent(cleaned); } catch (_) { return cleaned; }
      }
      // filename="..."
      const m = s.match(/filename\s*=\s*([^;]+)/i);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, '');
        return v || null;
      }
    } catch (_) {}
    return null;
  }

  _detectSignature(bytes) {
    try {
      const b0 = bytes[0];
      const b1 = bytes[1];
      const b2 = bytes[2];
      const b3 = bytes[3];

      // ZIP: "PK"
      if (b0 === 0x50 && b1 === 0x4b) {
        // Could be IFZ/IFCZIP most often for this package
        return { kind: 'zip', virtualName: 'model.ifczip' };
      }

      // GLB: "glTF"
      if (b0 === 0x67 && b1 === 0x6c && b2 === 0x54 && b3 === 0x46) {
        return { kind: 'glb', virtualName: 'model.glb' };
      }

      // Text signatures: decode a small prefix as ASCII
      const n = Math.min(bytes.length, 256);
      let text = '';
      for (let i = 0; i < n; i++) {
        const c = bytes[i];
        text += (c >= 32 && c <= 126) ? String.fromCharCode(c) : ' ';
      }
      const t = text.trim().toUpperCase();

      // IFC STEP: "ISO-10303-21"
      if (t.startsWith('ISO-10303-21')) {
        return { kind: 'ifc-step', virtualName: 'model.ifc' };
      }

      // DAE: XML with <COLLADA ...>
      if (t.startsWith('<?XML') || t.startsWith('<COLLADA') || t.includes('<COLLADA')) {
        return { kind: 'dae-xml', virtualName: 'model.dae' };
      }

      // OBJ: common first tokens ("mtllib", "o", "v", "#")
      if (/^(#|MTLLIB\s+|O\s+|V\s+|VN\s+|VT\s+)/i.test(text.trim())) {
        return { kind: 'obj-text', virtualName: 'model.obj' };
      }

      // STL ASCII: starts with "solid"
      if (t.startsWith('SOLID')) {
        return { kind: 'stl-ascii', virtualName: 'model.stl' };
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  async _readUrlPrefix(url, maxBytes = 4096) {
    if (typeof fetch !== 'function') return new Uint8Array();
    const u = String(url || '');
    const n = Math.max(1, Number(maxBytes) || 4096);

    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const headers = {};
    // Attempt Range. Some servers may ignore it; we still stop reading after maxBytes.
    try { headers.Range = `bytes=0-${n - 1}`; } catch (_) {}

    const res = await fetch(u, { method: 'GET', headers, signal: controller?.signal });
    if (!res || !res.ok) {
      throw new Error(`Failed to fetch url prefix: ${res?.status || 'unknown'}`);
    }

    // Prefer streaming to avoid downloading whole file if Range is ignored.
    const reader = res.body?.getReader?.();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.slice(0, n);
    }

    /** @type {Uint8Array[]} */
    const chunks = [];
    let total = 0;
    while (total < n) {
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) {
        chunks.push(value);
        total += value.length;
      }
    }

    try { controller?.abort?.(); } catch (_) {}

    const out = new Uint8Array(Math.min(total, n));
    let offset = 0;
    for (const c of chunks) {
      if (offset >= out.length) break;
      const take = Math.min(c.length, out.length - offset);
      out.set(c.subarray(0, take), offset);
      offset += take;
    }
    return out;
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

