import "./style.css";
import { Viewer } from "./viewer/Viewer.js";
import { IfcService } from "./ifc/IfcService.js";
import { IfcTreeView } from "./ifc/IfcTreeView.js";

// Инициализация three.js Viewer в контейнере #app
const app = document.getElementById("app");
if (app) {
  const viewer = new Viewer(app);
  viewer.init();
  // IFC загрузка
  const ifc = new IfcService(viewer);
  ifc.init();
  const ifcTreeEl = document.getElementById("ifcTree");
  const ifcTree = ifcTreeEl ? new IfcTreeView(ifcTreeEl) : null;

  const uploadBtn = document.getElementById("uploadBtn");
  const ifcInput = document.getElementById("ifcInput");
  if (uploadBtn && ifcInput) {
    uploadBtn.addEventListener("click", () => ifcInput.click());
    ifcInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await ifc.loadFile(file);
      ifcInput.value = "";
      // Обновим дерево IFC
      if (ifcTree) {
        const struct = await ifc.getSpatialStructure();
        ifcTree.render(struct);
      }
    });
  }

  // Кнопки качества и стиля
  const qualLow = document.getElementById("qualLow");
  const qualMed = document.getElementById("qualMed");
  const qualHigh = document.getElementById("qualHigh");
  const toggleEdges = document.getElementById("toggleEdges");
  const toggleShading = document.getElementById("toggleShading");

  const setActive = (btn) => {
    [qualLow, qualMed, qualHigh].forEach((b) => b && b.classList.remove("btn-active"));
    btn && btn.classList.add("btn-active");
  };
  qualLow?.addEventListener("click", () => { viewer.setQuality('low'); setActive(qualLow); });
  qualMed?.addEventListener("click", () => { viewer.setQuality('medium'); setActive(qualMed); });
  qualHigh?.addEventListener("click", () => { viewer.setQuality('high'); setActive(qualHigh); });

  let edgesOn = true;
  toggleEdges?.addEventListener("click", () => { edgesOn = !edgesOn; viewer.setEdgesVisible(edgesOn); });
  let flatOn = true;
  toggleShading?.addEventListener("click", () => { flatOn = !flatOn; viewer.setFlatShading(flatOn); });

  // Прелоадер: скрыть, когда Viewer готов, или через фолбэк 1с
  const preloader = document.getElementById("preloader");
  const zoomPanel = document.getElementById("zoomPanel");
  const hidePreloader = () => {
    if (preloader) preloader.style.display = "none";
    if (zoomPanel) zoomPanel.classList.remove("invisible");
  };
  app.addEventListener("viewer:ready", hidePreloader, { once: true });
  setTimeout(hidePreloader, 1000);

  // ЛЕВАЯ ПАНЕЛЬ: показать/скрыть
  const sidebar = document.getElementById("ifcSidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebarClose = document.getElementById("sidebarClose");
  const setSidebarVisible = (visible) => {
    if (!sidebar) return;
    if (visible) {
      sidebar.classList.remove("-translate-x-full");
      sidebar.classList.add("translate-x-0");
      sidebar.classList.remove("pointer-events-none");
    } else {
      sidebar.classList.add("-translate-x-full");
      sidebar.classList.remove("translate-x-0");
      sidebar.classList.add("pointer-events-none");
    }
  };
  sidebarToggle?.addEventListener("click", () => setSidebarVisible(true));
  sidebarClose?.addEventListener("click", () => setSidebarVisible(false));

  // Панель зума
  const zoomValue = document.getElementById("zoomValue");
  const zoomInBtn = document.getElementById("zoomIn");
  const zoomOutBtn = document.getElementById("zoomOut");
  if (zoomValue && zoomInBtn && zoomOutBtn) {
    const update = (p) => { zoomValue.textContent = `${p}%`; };
    viewer.addZoomListener(update);
    update(Math.round(viewer.getZoomPercent()));

    zoomInBtn.addEventListener("click", () => viewer.zoomIn());
    zoomOutBtn.addEventListener("click", () => viewer.zoomOut());
  }

  // Очистка при HMR (vite)
  if (import.meta.hot) {
    import.meta.hot.dispose(() => { ifc.dispose(); viewer.dispose(); });
  }
}

// Переключение темы daisyUI (light/dark)
document.getElementById("theme")?.addEventListener("click", () => {
  const root = document.documentElement;
  root.setAttribute("data-theme", root.getAttribute("data-theme") === "dark" ? "light" : "dark");
});