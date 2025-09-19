# Исправления для пакета @sequent-org/ifc-viewer

## Проблема

Пакет `@sequent-org/ifc-viewer` не работает с современными версиями Three.js из-за устаревших импортов и несовместимости API.

## Ошибки

### 1. Ошибка с mergeGeometries
```
ERROR: No matching export in "node_modules/three/examples/jsm/utils/BufferGeometryUtils.js" for import "mergeGeometries"
```

### 2. Ошибка с CSS импортом
```
Unknown file extension ".css" for C:\Users\popov\Herd\futurello-moodboard\node_modules\@sequent-org\ifc-viewer\src\style.css
```

### 3. Ошибка с импортом IFCLoader
```
Cannot find module 'C:\Users\popov\Herd\futurello-moodboard\node_modules\web-ifc-three\IFCLoader'
```

## Исправления

### 1. Исправить web-ifc-three/IFCLoader.js

**Файл:** `node_modules/web-ifc-three/IFCLoader.js`

**Строка 4** - исправить импорт:
```javascript
// БЫЛО:
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';

// ДОЛЖНО БЫТЬ:
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
```

**Строка 174** - исправить вызов:
```javascript
// БЫЛО:
const merged = mergeGeometries(geometriesByMaterial);

// ДОЛЖНО БЫТЬ:
const merged = mergeBufferGeometries(geometriesByMaterial);
```

**Строка 178** - исправить вызов:
```javascript
// БЫЛО:
const combinedGeometry = mergeGeometries(geometries, true);

// ДОЛЖНО БЫТЬ:
const combinedGeometry = mergeBufferGeometries(geometries, true);
```

### 2. Исправить @sequent-org/ifc-viewer/src/index.js

**Файл:** `node_modules/@sequent-org/ifc-viewer/src/index.js`

**Закомментировать автоматический импорт CSS:**
```javascript
// import "./style.css";
```

### 3. Исправить @sequent-org/ifc-viewer/src/ifc/IfcService.js

**Файл:** `node_modules/@sequent-org/ifc-viewer/src/ifc/IfcService.js`

**Добавить .js расширение к импорту:**
```javascript
// БЫЛО:
import { IFCLoader } from "web-ifc-three/IFCLoader";

// ДОЛЖНО БЫТЬ:
import { IFCLoader } from "web-ifc-three/IFCLoader.js";
```

## Рекомендации для постоянного исправления

### 1. Обновить зависимости
- Обновить `web-ifc-three` до совместимой версии
- Проверить совместимость версий Three.js
- Убедиться что Node.js поддерживает ES модули

### 2. Исправить импорты
- Добавить `.js` расширения ко всем импортам
- Заменить `mergeGeometries` на `mergeBufferGeometries`
- Проверить все импорты на совместимость

### 3. Сделать CSS опциональным
- Убрать автоматический импорт CSS из index.js
- Добавить параметр для включения/отключения стилей
- Документировать как подключать стили

### 4. Добавить fallback для WASM
- Добавить параметр `wasmUrl` в конструктор
- Реализовать fallback при ошибках загрузки WASM
- Добавить информативные сообщения об ошибках

### 5. Улучшить совместимость
- Добавить проверки версий зависимостей
- Реализовать graceful degradation
- Добавить подробную документацию по устранению неполадок

## Версии для проверки

- **Three.js:** проверить совместимость версий
- **web-ifc-three:** обновить до последней версии  
- **Node.js:** убедиться что поддерживает ES модули
- **Vite:** проверить настройки для WASM файлов

## После исправлений

1. Пересобрать пакет
2. Опубликовать обновленную версию
3. Обновить документацию
4. Протестировать с различными версиями Three.js

## Дополнительные улучшения

### 1. Убрать TailwindCSS
- Заменить на чистый CSS
- Убрать конфликты с Bootstrap
- Сделать стили более гибкими

### 2. Улучшить API
- Добавить параметр `wasmUrl`
- Добавить параметр `showSidebar`
- Добавить параметр `showControls`
- Добавить параметр `theme`

### 3. Добавить обработку ошибок
- Fallback при ошибках WASM
- Информативные сообщения
- Возможность скачать файл при ошибке

---

**Дата создания:** $(date)
**Автор:** AI Assistant
**Статус:** Требует исправления в пакете
