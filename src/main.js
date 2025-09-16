import "./style.css";
import { Viewer } from "./viewer/Viewer.js";

// Инициализация three.js Viewer в контейнере #app
const app = document.getElementById("app");
if (app) {
  const viewer = new Viewer(app);
  viewer.init();

  // Прелоадер: скрыть, когда Viewer готов, или через фолбэк 1с
  const preloader = document.getElementById("preloader");
  const zoomPanel = document.getElementById("zoomPanel");
  const hidePreloader = () => {
    if (preloader) preloader.style.display = "none";
    if (zoomPanel) zoomPanel.classList.remove("invisible");
  };
  app.addEventListener("viewer:ready", hidePreloader, { once: true });
  setTimeout(hidePreloader, 1000);

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
    import.meta.hot.dispose(() => viewer.dispose());
  }
}

// Переключение темы daisyUI (light/dark)
document.getElementById("theme")?.addEventListener("click", () => {
  const root = document.documentElement;
  root.setAttribute("data-theme", root.getAttribute("data-theme") === "dark" ? "light" : "dark");
});