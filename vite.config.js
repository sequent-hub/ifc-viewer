import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // web-ifc-three ожидает mergeGeometries в BufferGeometryUtils,
      // в three@0.149 его нет. Шимим через mergeBufferGeometries.
      'three/examples/jsm/utils/BufferGeometryUtils': fileURLToPath(new URL('./src/compat/three-buffer-geometry-utils.js', import.meta.url)),
    },
  },
});


