import "./style.css";
import { Viewer } from "./viewer/Viewer.js";
import { IfcService } from "./ifc/IfcService.js";
import { IfcTreeView } from "./ifc/IfcTreeView.js";

// Инициализация three.js Viewer в контейнере #app
const app = document.getElementById("app");
if (app) {
  const viewer = new Viewer(app);
  viewer.init();

  // Панель свойств: тени
  const shadowToggle = document.getElementById("shadowToggle");
  if (shadowToggle) {
    // По умолчанию тени выключены
    shadowToggle.checked = false;
    viewer.setShadowsEnabled(false);
    shadowToggle.addEventListener("change", (e) => {
      viewer.setShadowsEnabled(!!e.target.checked);
    });
  }

  // Панель свойств: солнце (глобальное освещение)
  const sunToggle = document.getElementById("sunToggle");
  const sunHeight = document.getElementById("sunHeight");
  const sunHeightValue = document.getElementById("sunHeightValue");
  if (sunToggle) {
    // По умолчанию включено
    sunToggle.checked = true;
    viewer.setSunEnabled(true);
    sunToggle.addEventListener("change", (e) => {
      const on = !!e.target.checked;
      viewer.setSunEnabled(on);
      if (sunHeight) sunHeight.disabled = !on;
    });
  }
  if (sunHeight) {
    // Дефолт синхронизирован с Viewer.init() (позиция солнца: y=5)
    sunHeight.value = "5.0";
    if (sunHeightValue) sunHeightValue.textContent = "5.0";
    viewer.setSunHeight(5.0);
    sunHeight.disabled = !(sunToggle ? !!sunToggle.checked : true);
    sunHeight.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (sunHeightValue) sunHeightValue.textContent = v.toFixed(1);
      viewer.setSunHeight(v);
    });
  }
  // IFC загрузка
  const ifc = new IfcService(viewer);
  ifc.init();
  const ifcTreeEl = document.getElementById("ifcTree");
  const ifcInfoEl = document.getElementById("ifcInfo");
  const ifcTree = ifcTreeEl ? new IfcTreeView(ifcTreeEl) : null;
  const ifcIsolateToggle = document.getElementById("ifcIsolateToggle");

  const uploadBtn = document.getElementById("uploadBtn");
  const ifcInput = document.getElementById("ifcInput");
  if (uploadBtn && ifcInput) {
    uploadBtn.addEventListener("click", () => ifcInput.click());
    ifcInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await ifc.loadFile(file);
      ifcInput.value = "";
      // Обновим дерево IFC и инфо
      const last = ifc.getLastInfo();
      const struct = await ifc.getSpatialStructure(last.modelID ? Number(last.modelID) : undefined);
      if (!struct) console.warn('IFC spatial structure not available for modelID', last?.modelID);
      if (ifcTree) ifcTree.render(struct);
      if (ifcInfoEl) {
        const info = ifc.getLastInfo();
        ifcInfoEl.innerHTML = `
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-xs">${info.name || '—'}</div>
              <div class="opacity-70">modelID: ${info.modelID || '—'}</div>
            </div>
          </div>`;
      }
      // Авто-открытие панели при ручной загрузке
      setSidebarVisible(true);
      hidePreloader();
    });
  }

  

  // Кнопки качества и стиля
  const qualLow = document.getElementById("qualLow");
  const qualMed = document.getElementById("qualMed");
  const qualHigh = document.getElementById("qualHigh");
  const toggleEdges = document.getElementById("toggleEdges");
  const toggleShading = document.getElementById("toggleShading");
  const clipXBtn = document.getElementById("clipX");
  const clipYBtn = document.getElementById("clipY");
  const clipZBtn = document.getElementById("clipZ");
  const clipXRange = document.getElementById("clipXRange");
  const clipYRange = document.getElementById("clipYRange");
  const clipZRange = document.getElementById("clipZRange");

  const setActive = (btn) => {
    [qualLow, qualMed, qualHigh].forEach((b) => b && b.classList.remove("btn-active"));
    btn && btn.classList.add("btn-active");
  };
  qualLow?.addEventListener("click", () => { viewer.setQuality('low'); setActive(qualLow); });
  qualMed?.addEventListener("click", () => { viewer.setQuality('medium'); setActive(qualMed); });
  qualHigh?.addEventListener("click", () => { viewer.setQuality('high'); setActive(qualHigh); });

  // Рёбра по умолчанию выключены
  let edgesOn = false;
  viewer.setEdgesVisible(edgesOn);
  toggleEdges?.addEventListener("click", () => { edgesOn = !edgesOn; viewer.setEdgesVisible(edgesOn); });
  let flatOn = true;
  toggleShading?.addEventListener("click", () => { flatOn = !flatOn; viewer.setFlatShading(flatOn); });

  // Переключатели секущих плоскостей: одиночный выбор без изменения логики Viewer
  let clipX = false, clipY = false, clipZ = false;
  let clipActive = null; // 'x' | 'y' | 'z' | null
  function setClipAxis(axis, enable) {
    // Сбросим предыдущую активную
    if (clipActive && clipActive !== axis) {
      viewer.setSection(clipActive, false, 0);
      if (clipActive === 'x') { clipX = false; clipXBtn?.classList.remove('btn-active'); }
      if (clipActive === 'y') { clipY = false; clipYBtn?.classList.remove('btn-active'); }
      if (clipActive === 'z') { clipZ = false; clipZBtn?.classList.remove('btn-active'); }
      clipActive = null;
    }
    // Применим новую ось
    viewer.setSection(axis, enable, 0);
    if (axis === 'x') { clipX = enable; clipXBtn?.classList.toggle('btn-active', enable); }
    if (axis === 'y') { clipY = enable; clipYBtn?.classList.toggle('btn-active', enable); }
    if (axis === 'z') { clipZ = enable; clipZBtn?.classList.toggle('btn-active', enable); }
    clipActive = enable ? axis : null;
  }
  clipXBtn?.addEventListener('click', () => setClipAxis('x', !clipX));
  clipYBtn?.addEventListener('click', () => setClipAxis('y', !clipY));
  clipZBtn?.addEventListener('click', () => setClipAxis('z', !clipZ));

  // Слайдеры позиции плоскостей: значение [0..1] маппим на габариты модели
  clipXRange?.addEventListener('input', (e) => {
    const t = Number(e.target.value);
    viewer.setSectionNormalized('x', clipX, t);
  });
  clipYRange?.addEventListener('input', (e) => {
    const t = Number(e.target.value);
    viewer.setSectionNormalized('y', clipY, t);
  });
  clipZRange?.addEventListener('input', (e) => {
    const t = Number(e.target.value);
    viewer.setSectionNormalized('z', clipZ, t);
  });

  // Прелоадер: скрыть, когда Viewer готов, или через фолбэк 1с
  const preloader = document.getElementById("preloader");
  const zoomPanel = document.getElementById("zoomPanel");
  const hidePreloader = () => {
    if (preloader) {
      preloader.style.transition = "opacity 400ms ease";
      preloader.style.willChange = "opacity";
      preloader.style.opacity = "0";
      // удалим из DOM после анимации
      setTimeout(() => { preloader.parentNode && preloader.parentNode.removeChild(preloader); }, 450);
    }
    if (zoomPanel) zoomPanel.classList.remove("invisible");
  };

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

  // Переключатель изоляции
  ifcIsolateToggle?.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    ifc.setIsolateMode(enabled);
  });

  // Выбор узла в дереве → подсветка/изоляция
  if (ifcTree) {
    ifcTree.onSelect(async (node) => {
      const ids = ifc.collectElementIDsFromStructure(node);
      await ifc.highlightByIds(ids);
    });
  }

  // Скрывать прелоадер, когда модель реально загружена (страховка от гонок)
  document.addEventListener('ifc:model-loaded', () => {
    hidePreloader();
  }, { once: true });

  // Автозагрузка IFC: используем образец по умолчанию, параметр ?ifc= может переопределить
  try {
    const DEFAULT_IFC_URL = "/ifc/170ОК-23_1_1_АР_П.ifc";
    const params = new URLSearchParams(location.search);
    const ifcUrlParam = params.get('ifc');
    const ifcUrl = ifcUrlParam || DEFAULT_IFC_URL;
    const model = await ifc.loadUrl(encodeURI(ifcUrl));
    if (model) {
      const struct = await ifc.getSpatialStructure();
      if (ifcTree) ifcTree.render(struct);
      if (ifcInfoEl) {
        const info = ifc.getLastInfo();
        ifcInfoEl.innerHTML = `
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-xs">${info.name || '—'}</div>
              <div class="opacity-70">modelID: ${info.modelID || '—'}</div>
            </div>
          </div>`;
      }
      // Не открываем панель автоматически при автозагрузке
      hidePreloader();
    }
  } catch (e) {
    console.warn('IFC autoload error', e);
  }

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