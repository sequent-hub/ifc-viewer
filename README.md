# @sequent-org/ifc-viewer

IFC 3D model viewer component for web applications. Основан на Three.js и web-ifc для просмотра BIM моделей в браузере.

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
    ifcUrl: ifcUrl
    // Минимальный режим по умолчанию - только просмотрщик с верхней панелью
  })
  
  viewer.init().then(() => {
    modal.style.display = 'flex'
  })
}
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

## ⚙️ Опции конфигурации

| Опция | Тип | По умолчанию | Описание |
|-------|-----|--------------|----------|
| `container` | `HTMLElement \| string` | **обязательно** | DOM элемент или селектор для контейнера |
| `ifcUrl` | `string` | `null` | URL для загрузки IFC файла |
| `ifcFile` | `File` | `null` | File объект для загрузки |
| `showSidebar` | `boolean` | `false` | Показывать боковую панель с деревом |
| `showControls` | `boolean` | `false` | Показывать нижние кнопки управления |
| `showToolbar` | `boolean` | `true` | Показывать верхнюю панель инструментов |
| `autoLoad` | `boolean` | `true` | Автоматически загружать при инициализации |
| `theme` | `string` | `'light'` | Тема интерфейса (`'light'` \| `'dark'`) |

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

Стили подключаются автоматически при импорте пакета. Если нужно подключить стили отдельно:

```javascript
import '@sequent-org/ifc-viewer/style.css'
```

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
npm run test
```

Откроется страница `test.html` с интерактивными тестами.

## 📦 Поддерживаемые форматы

- `.ifc` - стандартные IFC файлы
- `.ifczip` - архивы IFC
- `.zip` - ZIP архивы с IFC файлами

## 🔧 Системные требования

- Node.js >= 16
- Современный браузер с поддержкой WebGL
- Для работы требуются файлы `web-ifc.wasm` в публичной папке проекта

## 📄 Лицензия

MIT License

## 🤝 Поддержка

Для вопросов и предложений создавайте Issues в репозитории проекта.
