import "./style.css";
import { Viewer } from "./viewer/Viewer.js";

// Инициализация three.js Viewer в контейнере #app
const app = document.getElementById("app");
if (app) {
  const viewer = new Viewer(app);
  viewer.init();

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