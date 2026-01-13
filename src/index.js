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

// Расширяемая архитектура загрузчиков форматов
export { ModelLoaderRegistry } from "./model-loading/ModelLoaderRegistry.js";
export { IfcModelLoader } from "./model-loading/loaders/IfcModelLoader.js";
export { FbxModelLoader } from "./model-loading/loaders/FbxModelLoader.js";
export { GltfModelLoader } from "./model-loading/loaders/GltfModelLoader.js";
export { ObjModelLoader } from "./model-loading/loaders/ObjModelLoader.js";
export { TdsModelLoader } from "./model-loading/loaders/TdsModelLoader.js";
export { StlModelLoader } from "./model-loading/loaders/StlModelLoader.js";
export { DaeModelLoader } from "./model-loading/loaders/DaeModelLoader.js";
export { ThreeDmModelLoader } from "./model-loading/loaders/ThreeDmModelLoader.js";
