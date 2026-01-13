import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

function main() {
  const appRoot = process.env.INIT_CWD || process.cwd();
  const req = createRequire(import.meta.url);

  /** @type {string|null} */
  let threePkgJson = null;
  try {
    threePkgJson = req.resolve('three/package.json', { paths: [appRoot, process.cwd()] });
  } catch (_) {
    threePkgJson = null;
  }

  const threeDir = threePkgJson ? path.dirname(threePkgJson) : path.join(appRoot, 'node_modules', 'three');
  const target = path.join(threeDir, 'examples', 'jsm', 'loaders', '3DMLoader.js');

  if (!fs.existsSync(target)) {
    console.warn('[patch-three-3dm-loader] Target not found, skip', { target });
    return;
  }

  const src = fs.readFileSync(target, 'utf8');
  // Already patched?
  if (src.includes('doc.instanceDefinitions().count;') || src.includes('doc.materials().count;')) {
    console.log('[patch-three-3dm-loader] Already patched');
    return;
  }

  let out = src;
  const replacements = [
    ['doc.instanceDefinitions().count()', 'doc.instanceDefinitions().count'],
    ['doc.materials().count()', 'doc.materials().count'],
    ['doc.layers().count()', 'doc.layers().count'],
    ['doc.views().count()', 'doc.views().count'],
    ['doc.namedViews().count()', 'doc.namedViews().count'],
    ['doc.groups().count()', 'doc.groups().count'],
    ['doc.strings().count()', 'doc.strings().count'],
  ];

  let changed = 0;
  for (const [from, to] of replacements) {
    const before = out;
    out = out.split(from).join(to);
    if (out !== before) changed++;
  }

  if (out === src) {
    console.warn('[patch-three-3dm-loader] No changes applied (unexpected)', { target });
    return;
  }

  fs.writeFileSync(target, out, 'utf8');
  console.log('[patch-three-3dm-loader] Patched', { target, rulesApplied: changed });
}

main();

