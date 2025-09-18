# @sequent-org/ifc-viewer

IFC 3D model viewer component for web applications. Основан на Three.js и web-ifc для просмотра BIM моделей в браузере.

**✨ Полностью автономный пакет** - не требует внешних CSS фреймворков (Tailwind, Bootstrap и т.д.).

## 🚀 Установка

```bash
npm install @sequent-org/ifc-viewer
```

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

**Настройка WASM файла в Laravel:**

1. Скопируйте `web-ifc.wasm` в папку `public/storage/`:
```bash
cp node_modules/web-ifc/web-ifc.wasm public/storage/
```

2. Или используйте символическую ссылку:
```bash
php artisan storage:link
# Затем скопируйте файл в storage/app/public/
```

3. Альтернативно, укажите путь к файлу в `node_modules`:
```javascript
const viewer = new IfcViewer({
  container: container,
  ifcUrl: ifcUrl,
  wasmUrl: '/node_modules/web-ifc/web-ifc.wasm'
})
```

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

## 🔧 Системные требования

- Node.js >= 16
- Современный браузер с поддержкой WebGL и WebAssembly
- Для работы требуются файлы `web-ifc.wasm` в публичной папке проекта
- Поддержка ES6 модулей в браузере

## 📄 Лицензия

MIT License

## 🤝 Поддержка

Для вопросов и предложений создавайте Issues в репозитории проекта.
