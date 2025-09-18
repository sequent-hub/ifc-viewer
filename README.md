# @sequent-org/ifc-viewer

IFC 3D model viewer component for web applications. Основан на Three.js и web-ifc для просмотра BIM моделей в браузере.

**✨ Полностью автономный пакет** - не требует внешних CSS фреймворков (Tailwind, Bootstrap и т.д.).

## ⚡ Быстрый старт для интеграции

### Минимальная настройка

1. **Установите пакет:**
   ```bash
   npm install @sequent-org/ifc-viewer
   ```

2. **Используйте в коде:**
   ```javascript
   import { IfcViewer } from '@sequent-org/ifc-viewer'
   
   const viewer = new IfcViewer({
     container: '#viewer-container',
     ifcUrl: '/path/to/model.ifc'
   })
   
   await viewer.init()
   ```

**Готово!** Пакет полностью автоматический - никаких дополнительных настроек не требуется.

## 🚀 Установка

```bash
npm install @sequent-org/ifc-viewer
```

### ✨ Полная автоматизация

**Никаких дополнительных настроек не требуется!** Пакет автоматически:

- ✅ Находит WASM файл из node_modules
- ✅ Применяет патч совместимости Three.js
- ✅ Отключает Web Workers для стабильности
- ✅ Работает в любом проекте "из коробки"

**Умный поиск WASM:** Пакет автоматически ищет файл по путям:
- `/node_modules/web-ifc/web-ifc.wasm` (основной путь)
- `/wasm/web-ifc.wasm` (если скопировали в public/wasm/)
- `/web-ifc.wasm` (если скопировали в корень public/)
- И другие стандартные пути

**Важно:** Пакет использует парсинг в главном потоке (Web Workers отключены) для максимальной совместимости с различными окружениями.

## 📋 Основное использование

### Простой пример

```javascript
import { IfcViewer } from '@sequent-org/ifc-viewer'

// Создание просмотрщика с автозагрузкой модели (минимальный режим)
const viewer = new IfcViewer({
  container: document.getElementById('viewer-container'),
  ifcUrl: '/path/to/model.ifc'
  // showSidebar: false (по умолчанию)
  // showControls: false (по умолчанию) 
  // showToolbar: true (по умолчанию)
  // wasmUrl: null (автоматически определяет путь к WASM)
})

await viewer.init()
```

### Пример с кастомным WASM путем

```javascript
import { IfcViewer } from '@sequent-org/ifc-viewer'

const viewer = new IfcViewer({
  container: document.getElementById('viewer-container'),
  ifcUrl: '/models/building.ifc',
  wasmUrl: '/custom-path/web-ifc.wasm'  // Кастомный путь к WASM файлу
})

await viewer.init()
```

### Интеграция в Laravel + Vite

В Laravel проекте с Vite:

```javascript
// В вашем JS файле  
import { IfcViewer } from '@sequent-org/ifc-viewer'

function showIfcModal(ifcUrl) {
  const modal = document.getElementById('ifc-modal')
  const container = modal.querySelector('.modal-content')
  
  const viewer = new IfcViewer({
    container: container,
    ifcUrl: ifcUrl,
    wasmUrl: '/storage/web-ifc.wasm'  // Путь к WASM в Laravel storage
    // Минимальный режим по умолчанию - только просмотрщик с верхней панелью
  })
  
  viewer.init().then(() => {
    modal.style.display = 'flex'
  })
}
```

**Настройка в Laravel:**

WASM файл автоматически загружается из node_modules. Дополнительная настройка не требуется!

**Для кастомных путей (опционально):**
```javascript
const viewer = new IfcViewer({
  container: container,
  ifcUrl: ifcUrl,
  wasmUrl: '/storage/web-ifc.wasm'  // Только если нужен кастомный путь
})
```

**Важно для Laravel:** Пакет работает "из коробки" без дополнительных настроек Vite.

## 🔧 Особенности и совместимость

### ✅ Что включено в пакет

- **Автономные стили** - не требует Tailwind CSS, Bootstrap или других фреймворков
- **Умный поиск WASM** - автоматический поиск по популярным путям
- **Отключенные Web Workers** - парсинг в главном потоке для максимальной совместимости
- **Fallback защита** - автоматическое переключение на резервные пути при ошибках WASM
- **Обработка ошибок** - graceful degradation при критических ошибках
- **Поддержка wasmUrl** - гибкая настройка пути к WASM файлу
- **Патч совместимости Three.js** - автоматическое исправление проблем с mergeGeometries

### 🚫 Что НЕ включено

- **IFCWorker** - Web Workers отключены для предотвращения проблем интеграции
- **Внешние зависимости** - все стили и ресурсы включены в пакет
- **WASM файл** - нужно скопировать из node_modules (один раз)

### 🎯 Совместимость

- **Браузеры:** Chrome 80+, Firefox 75+, Safari 13+, Edge 80+
- **Фреймворки:** React, Vue, Angular, Laravel, Next.js, Nuxt.js
- **Сборщики:** Vite, Webpack, Rollup
- **Серверы:** Node.js, PHP, Python, .NET

### Загрузка пользовательского файла

```javascript
const viewer = new IfcViewer({
  container: '#viewer-container',
  autoLoad: false  // не загружать автоматически
  // По умолчанию только верхняя панель, загрузка через кнопку "📁 Загрузить"
})

await viewer.init()

// Альтернативно: программная загрузка файла
const fileInput = document.getElementById('file-input')
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (file) {
    await viewer.loadModel(file)
  }
})
```

### Кастомный путь к WASM файлу

```javascript
const viewer = new IfcViewer({
  container: '#viewer-container',
  ifcUrl: '/models/building.ifc',
  wasmUrl: '/custom-path/web-ifc.wasm'  // Указываем свой путь к WASM
})

await viewer.init()
```

## ⚙️ Опции конфигурации

| Опция | Тип | По умолчанию | Описание |
|-------|-----|--------------|----------|
| `container` | `HTMLElement \| string` | **обязательно** | DOM элемент или селектор для контейнера |
| `ifcUrl` | `string` | `null` | URL для загрузки IFC файла |
| `ifcFile` | `File` | `null` | File объект для загрузки |
| `wasmUrl` | `string` | `null` | URL для загрузки WASM файла web-ifc |
| `showSidebar` | `boolean` | `false` | Показывать боковую панель с деревом |
| `showControls` | `boolean` | `false` | Показывать нижние кнопки управления |
| `showToolbar` | `boolean` | `true` | Показывать верхнюю панель инструментов |
| `autoLoad` | `boolean` | `true` | Автоматически загружать при инициализации |
| `theme` | `string` | `'light'` | Тема интерфейса (`'light'` \| `'dark'`) |

### 🔧 Подробное описание параметров

#### `wasmUrl` - Настройка пути к WASM файлу

Параметр `wasmUrl` позволяет указать кастомный путь к WASM файлу библиотеки `web-ifc`. Это особенно полезно при интеграции пакета в проекты с нестандартной структурой ресурсов.

**Особенности:**
- **По умолчанию**: Если не указан, используется автоматически определяемый путь из папки `public/wasm/`
- **Поддержка форматов**: Полные URL (`https://example.com/web-ifc.wasm`) и относительные пути (`/assets/web-ifc.wasm`)
- **Обратная совместимость**: При ошибке загрузки кастомного пути автоматически переключается на дефолтный
- **Обработка ошибок**: В консоль выводится предупреждение при неудачной настройке кастомного пути

**Примеры использования:**

```javascript
// Относительный путь
const viewer1 = new IfcViewer({
  container: '#viewer',
  wasmUrl: '/assets/web-ifc.wasm'
})

// Полный URL
const viewer2 = new IfcViewer({
  container: '#viewer', 
  wasmUrl: 'https://cdn.example.com/web-ifc.wasm'
})

// Путь с подпапкой
const viewer3 = new IfcViewer({
  container: '#viewer',
  wasmUrl: '/static/libs/web-ifc.wasm'
})
```

**Когда использовать:**
- При размещении WASM файла в нестандартной папке
- При использовании CDN для статических ресурсов
- При интеграции в фреймворки с особой структурой ресурсов (Laravel, Next.js и т.д.)

## 🎯 API методы

### Основные методы

```javascript
// Инициализация просмотрщика
await viewer.init()

// Загрузка модели
await viewer.loadModel('/path/to/model.ifc')  // по URL
await viewer.loadModel(fileObject)            // File объект

// Управление интерфейсом
viewer.setSidebarVisible(true)
viewer.setTheme('dark')

// Получение информации
const modelInfo = viewer.getModelInfo()
const threeViewer = viewer.getViewer()
const ifcService = viewer.getIfcService()

// Освобождение ресурсов
viewer.dispose()
```

## 📡 События

Просмотрщик отправляет пользовательские события:

```javascript
const container = document.getElementById('viewer-container')

// Готовность к работе
container.addEventListener('ifcviewer:ready', (e) => {
  console.log('Просмотрщик готов', e.detail.viewer)
})

// Модель загружена
container.addEventListener('ifcviewer:model-loaded', (e) => {
  console.log('Модель загружена', e.detail.model)
})

// Ошибка
container.addEventListener('ifcviewer:error', (e) => {
  console.error('Ошибка просмотрщика', e.detail.error)
})

// Освобождение ресурсов
container.addEventListener('ifcviewer:disposed', (e) => {
  console.log('Ресурсы освобождены')
})
```

## 🎨 Стили

**Стили подключаются автоматически** при импорте пакета и полностью **автономны** - не требуют Tailwind CSS, Bootstrap или других внешних фреймворков.

Если нужно подключить стили отдельно:

```javascript
import '@sequent-org/ifc-viewer/style.css'
```

**Преимущества локальных стилей:**
- ✅ Полная автономность пакета
- ✅ Нет конфликтов с CSS фреймворками сайта  
- ✅ Меньший размер bundle'а
- ✅ Быстрая загрузка без внешних зависимостей

## 🎛️ Функции верхней панели

При включенной опции `showToolbar` доступны следующие инструменты:

### Качество рендеринга
- **Low** - Низкое качество для слабых устройств
- **Med** - Среднее качество (по умолчанию)  
- **High** - Высокое качество для детального просмотра

### Стили отображения
- **Edges** - Показ/скрытие контуров граней
- **Flat** - Переключение плоского/гладкого затенения

### Секущие плоскости
- **Clip X/Y/Z** - Активация секущих плоскостей по осям
- При активации появляются слайдеры для точной настройки позиции
- Одновременно активна только одна плоскость

### Загрузка файлов
- **📁 Загрузить** - Кнопка выбора IFC файла пользователем

## 🧪 Тестирование

Для локального тестирования пакета:

```bash
git clone <repo-url>
cd ifc-viewer
npm install
npm run test:manual
```

Откроется страница `test.html` с интерактивными тестами.

## 📦 Поддерживаемые форматы

- `.ifc` - стандартные IFC файлы
- `.ifczip` - архивы IFC
- `.zip` - ZIP архивы с IFC файлами

## 🔧 Troubleshooting

### Проблемы с WASM файлом

**Ошибка загрузки WASM:**
```
Failed to load web-ifc.wasm
```

**Решения:**
1. **Проверьте путь к файлу:**
   ```javascript
   // Убедитесь, что файл доступен по указанному пути
   const viewer = new IfcViewer({
     container: '#viewer',
     wasmUrl: '/correct-path/web-ifc.wasm'
   })
   ```

2. **Проверьте CORS настройки:**
   - Для локальной разработки используйте относительные пути
   - Для продакшена настройте CORS для WASM файлов

3. **Проверьте MIME-тип:**
   ```nginx
   # В nginx.conf
   location ~* \.wasm$ {
       add_header Content-Type application/wasm;
   }
   ```

4. **Альтернативные пути:**
   ```javascript
   // Попробуйте разные варианты
   wasmUrl: '/web-ifc.wasm'           // корень
   wasmUrl: '/assets/web-ifc.wasm'   // папка assets
   wasmUrl: '/static/web-ifc.wasm'   // папка static
   ```

**Отладка:**
- Откройте DevTools → Network и проверьте загрузку WASM файла
- Проверьте консоль на предупреждения о `wasmUrl`
- Убедитесь, что файл `web-ifc.wasm` существует и доступен

### Проблемы с Web Workers

**Ошибка IFCWorker:**
```
Failed to load IFCWorker.js
```

**Решение:** Эта ошибка не должна возникать, так как Web Workers отключены в пакете. Если она появляется:

1. **Проверьте версию пакета:**
   ```bash
   npm list @sequent-org/ifc-viewer
   ```

### Проблемы совместимости с Three.js

**Ошибка mergeGeometries:**
```
mergeGeometries is not a function
```

**Решение:** Пакет автоматически применяет патч совместимости для Three.js 0.149+. Если проблемы продолжаются:

1. **Проверьте версию Three.js:**
   ```bash
   npm list three
   ```

2. **Убедитесь, что используется Three.js 0.149+:**
   ```bash
   npm install three@^0.149.0
   ```

2. **Очистите кэш:**
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Проверьте консоль браузера** - должно быть сообщение "Web Workers отключены"

### Проблемы интеграции

**Ошибка при импорте:**
```
Cannot resolve module '@sequent-org/ifc-viewer'
```

**Решения:**
1. **Убедитесь в правильной установке:**
   ```bash
   npm install @sequent-org/ifc-viewer
   ```

2. **Проверьте package.json:**
   ```json
   {
     "dependencies": {
       "@sequent-org/ifc-viewer": "^1.0.1"
     }
   }
   ```

3. **Для TypeScript проектов:**
   ```typescript
   import { IfcViewer } from '@sequent-org/ifc-viewer'
   ```

## 🔧 Системные требования

- Node.js >= 16
- Современный браузер с поддержкой WebGL и WebAssembly
- Для работы требуются файлы `web-ifc.wasm` в публичной папке проекта
- Поддержка ES6 модулей в браузере

## 👨‍💻 Информация для разработчиков

### Архитектура пакета

- **IfcViewer** - основной класс-обертка для интеграции
- **IfcService** - сервис загрузки и парсинга IFC файлов
- **Viewer** - Three.js сцена и рендеринг
- **IfcTreeView** - компонент дерева IFC структуры

### Ключевые особенности

- **Web Workers отключены** - парсинг в главном потоке
- **IFCWorker исключен** - предотвращает проблемы интеграции
- **Fallback защита** - множественные пути к WASM файлу
- **Автономные стили** - встроенные CSS без внешних зависимостей

### Для ассистентов по интеграции

При помощи с интеграцией пакета учитывайте:

1. **WASM файл автоматически найден** - никаких дополнительных настроек не требуется
2. **Web Workers отключены** - не пытайтесь их включить
3. **Используйте параметр wasmUrl** только для кастомных путей к WASM файлу
4. **Пакет полностью автономен** - не требует внешних CSS фреймворков
5. **Поддерживает все современные фреймворки** - React, Vue, Angular, Laravel
6. **Работает "из коробки"** - просто установите и используйте

### Отладка

- Проверьте консоль на сообщение "Web Workers отключены"
- WASM файл автоматически загружается из node_modules
- Используйте DevTools → Network для проверки загрузки ресурсов
- При проблемах используйте параметр `wasmUrl` для кастомного пути

## 📄 Лицензия

MIT License

## 🤝 Поддержка

Для вопросов и предложений создавайте Issues в репозитории проекта.
