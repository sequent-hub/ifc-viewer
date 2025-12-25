import fs from 'node:fs';
import path from 'node:path';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function main() {
  const root = process.cwd();
  const src = path.join(root, 'node_modules', 'web-ifc', 'web-ifc.wasm');
  const dst = path.join(root, 'public', 'wasm', 'web-ifc.wasm');

  if (!fs.existsSync(src)) {
    console.error(`[copy-web-ifc-wasm] Source not found: ${src}`);
    process.exitCode = 1;
    return;
  }

  copyFile(src, dst);

  const s = fs.statSync(src);
  const d = fs.statSync(dst);
  console.log('[copy-web-ifc-wasm] OK', {
    src: path.relative(root, src),
    dst: path.relative(root, dst),
    bytes: d.size,
    sameSize: s.size === d.size,
  });
}

main();


