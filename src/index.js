// Основная точка входа пакета @sequent-org/ifc-viewer
// Автоматически подключает стили и экспортирует API

// CSS импорт закомментирован для совместимости с Node.js
// Стили загружаются автоматически через IfcViewer.js
// import './style.css';

// Экспортируем основной класс
export { IfcViewer } from "./IfcViewer.js";

// Экспортируем вспомогательные классы для расширенного использования
export { Viewer } from "./viewer/Viewer.js";
export { IfcService } from "./ifc/IfcService.js";
export { IfcTreeView } from "./ifc/IfcTreeView.js";
