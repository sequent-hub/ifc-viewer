// Основная точка входа пакета @sequent-org/ifc-viewer
// Автоматически подключает стили и экспортирует API

// Подключаем стили только в браузерном окружении
if (typeof window !== 'undefined') {
  import('./style.css');
}

// Экспортируем основной класс
export { IfcViewer } from "./IfcViewer.js";

// Экспортируем вспомогательные классы для расширенного использования
export { Viewer } from "./viewer/Viewer.js";
export { IfcService } from "./ifc/IfcService.js";
export { IfcTreeView } from "./ifc/IfcTreeView.js";
