import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

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
    },
    {
      name: 'copy-wasm-from-package',
      generateBundle(options, bundle) {
        // Автоматически копируем WASM файл из node_modules в сборку пакета
        try {
          const wasmPath = join(process.cwd(), 'node_modules', 'web-ifc', 'web-ifc.wasm');
          if (existsSync(wasmPath)) {
            const wasmContent = require('fs').readFileSync(wasmPath);
            bundle['wasm/web-ifc.wasm'] = {
              type: 'asset',
              fileName: 'wasm/web-ifc.wasm',
              source: wasmContent
            };
            console.log('✅ WASM файл автоматически включен в сборку пакета');
          } else {
            console.warn('⚠️ WASM файл не найден в node_modules/web-ifc/');
          }
        } catch (error) {
          console.error('❌ Ошибка копирования WASM файла:', error.message);
        }
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
      ],
      output: {
        // Включаем WASM файл в сборку пакета
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'web-ifc.wasm') {
            return 'wasm/web-ifc.wasm'
          }
          return assetInfo.name
        }
      }
    },
    // Копируем WASM файл из node_modules в сборку
    copyPublicDir: false,
    assetsInclude: ['**/*.wasm']
  },
});


