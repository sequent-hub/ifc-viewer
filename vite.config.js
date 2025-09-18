import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    {
      name: 'ifc-wasm-rewrite',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          // Перенаправляем любые запросы воркера к wasm внутри node_modules на наш публичный ассет
          if (url.startsWith('/node_modules/web-ifc-three/wasm/web-ifc.wasm') || url.includes('/node_modules/web-ifc-three//wasm/web-ifc.wasm')) {
            res.statusCode = 302;
            res.setHeader('Location', '/wasm/web-ifc.wasm');
            res.end();
            return;
          }
          next();
        });
      }
    }
  ],
  resolve: {
    alias: {
      // web-ifc-three ожидает mergeGeometries в BufferGeometryUtils,
      // в three@0.149 его нет. Шимим через mergeBufferGeometries.
      'three/examples/jsm/utils/BufferGeometryUtils': fileURLToPath(new URL('./src/compat/three-buffer-geometry-utils.js', import.meta.url)),
    },
  },
  optimizeDeps: {
    // Не оптимизировать emscripten-модули, чтобы не ломать загрузку wasm
    exclude: ['web-ifc', 'web-ifc-three'],
  },
  build: {
    rollupOptions: {
      external: [
        // Исключаем worker файлы из сборки, так как мы их не используем
        'web-ifc-three/IFCWorker.js',
        'web-ifc-three/IFCWorker.js?url'
      ]
    }
  },
});


