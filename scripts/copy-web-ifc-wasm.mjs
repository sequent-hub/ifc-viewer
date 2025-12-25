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

  const dst = path.join(appRoot, 'public', 'wasm', 'web-ifc.wasm');

  if (!fs.existsSync(src)) {
    console.error(`[copy-web-ifc-wasm] Source not found: ${src}`);
    process.exitCode = 1;
    return;
  }

  copyFile(src, dst);

  const s = fs.statSync(src);
  const d = fs.statSync(dst);
  console.log('[copy-web-ifc-wasm] OK', {
    appRoot: appRoot,
    src: src,
    dst: dst,
    bytes: d.size,
    sameSize: s.size === d.size,
  });
}

main();


