import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// bump when web-ifc version changes (used for cache-busting via directory name)
const WASM_DIR_VERSION = '0.0.74';

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

  // Resolve actual installed web-ifc location (hoisted or nested).
  const req = createRequire(import.meta.url);
  let webIfcPkgJson = null;
  try {
    webIfcPkgJson = req.resolve('web-ifc/package.json', { paths: [appRoot, process.cwd()] });
  } catch (_) {
    webIfcPkgJson = null;
  }

  const src = webIfcPkgJson
    ? path.join(path.dirname(webIfcPkgJson), 'web-ifc.wasm')
    : path.join(appRoot, 'node_modules', 'web-ifc', 'web-ifc.wasm');

  // Default location (legacy)
  const dst = path.join(appRoot, 'public', 'wasm', 'web-ifc.wasm');
  // Versioned location (recommended to avoid cache-mismatch for end-users)
  const dstV = path.join(appRoot, 'public', 'wasm', `v${WASM_DIR_VERSION}`, 'web-ifc.wasm');

  if (!fs.existsSync(src)) {
    console.error(`[copy-web-ifc-wasm] Source not found: ${src}`);
    process.exitCode = 1;
    return;
  }

  copyFile(src, dst);
  copyFile(src, dstV);

  const s = fs.statSync(src);
  const d = fs.statSync(dst);
  const dv = fs.statSync(dstV);
  console.log('[copy-web-ifc-wasm] OK', {
    appRoot: appRoot,
    src: src,
    dst: dst,
    dstV: dstV,
    versionDir: `v${WASM_DIR_VERSION}`,
    bytes: d.size,
    sameSize: s.size === d.size,
    sameSizeV: s.size === dv.size,
  });
}

main();


