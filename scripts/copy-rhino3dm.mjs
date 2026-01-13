import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function main() {
  // npm sets INIT_CWD to the original working directory where `npm install` was invoked.
  // That is the app root we need to copy into.
  const appRoot = process.env.INIT_CWD || process.cwd();

  const req = createRequire(import.meta.url);

  /** @type {string|null} */
  let pkgJsonPath = null;
  try {
    pkgJsonPath = req.resolve('rhino3dm/package.json', { paths: [appRoot, process.cwd()] });
  } catch (_) {
    pkgJsonPath = null;
  }

  const pkgDir = pkgJsonPath ? path.dirname(pkgJsonPath) : path.join(appRoot, 'node_modules', 'rhino3dm');

  const version = (() => {
    try {
      if (pkgJsonPath && fs.existsSync(pkgJsonPath)) {
        const raw = fs.readFileSync(pkgJsonPath, 'utf8');
        const json = JSON.parse(raw);
        return String(json?.version || '').trim() || 'unknown';
      }
    } catch (_) {}
    return 'unknown';
  })();

  const srcJs = path.join(pkgDir, 'rhino3dm.js');
  const srcWasm = path.join(pkgDir, 'rhino3dm.wasm');

  const dstDir = path.join(appRoot, 'public', 'wasm', 'rhino3dm');
  const dstJs = path.join(dstDir, 'rhino3dm.js');
  const dstWasm = path.join(dstDir, 'rhino3dm.wasm');

  const dstDirV = path.join(dstDir, `v${version}`);
  const dstJsV = path.join(dstDirV, 'rhino3dm.js');
  const dstWasmV = path.join(dstDirV, 'rhino3dm.wasm');

  if (!fs.existsSync(srcJs) || !fs.existsSync(srcWasm)) {
    console.error('[copy-rhino3dm] Source not found', {
      appRoot,
      pkgDir,
      srcJs,
      srcWasm,
      existsJs: fs.existsSync(srcJs),
      existsWasm: fs.existsSync(srcWasm),
    });
    process.exitCode = 1;
    return;
  }

  copyFile(srcJs, dstJs);
  copyFile(srcWasm, dstWasm);

  // Versioned location (recommended to avoid cache-mismatch for end-users)
  copyFile(srcJs, dstJsV);
  copyFile(srcWasm, dstWasmV);

  const sJs = fs.statSync(srcJs);
  const sWasm = fs.statSync(srcWasm);
  const dJs = fs.statSync(dstJs);
  const dWasm = fs.statSync(dstWasm);

  console.log('[copy-rhino3dm] OK', {
    appRoot,
    versionDir: `v${version}`,
    src: { js: srcJs, wasm: srcWasm },
    dst: { js: dstJs, wasm: dstWasm },
    dstV: { js: dstJsV, wasm: dstWasmV },
    bytes: { js: dJs.size, wasm: dWasm.size },
    sameSize: { js: sJs.size === dJs.size, wasm: sWasm.size === dWasm.size },
  });
}

main();

