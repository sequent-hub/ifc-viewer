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
  const shadowGradToggle = document.getElementById("shadowGradToggle");
  const shadowGradLen = document.getElementById("shadowGradLen");
  const shadowGradLenValue = document.getElementById("shadowGradLenValue");
  const shadowGradStr = document.getElementById("shadowGradStr");
  const shadowGradStrValue = document.getElementById("shadowGradStrValue");
  const shadowGradCurve = document.getElementById("shadowGradCurve");
  const shadowGradCurveValue = document.getElementById("shadowGradCurveValue");
  const shadowOpacity = document.getElementById("shadowOpacity");
  const shadowOpacityValue = document.getElementById("shadowOpacityValue");
  const shadowSoft = document.getElementById("shadowSoft");
  const shadowSoftValue = document.getElementById("shadowSoftValue");
  // Материалы
  const matPreset = document.getElementById("matPreset");
  const matRough = document.getElementById("matRough");
  const matRoughValue = document.getElementById("matRoughValue");
  const matMetal = document.getElementById("matMetal");
  const matMetalValue = document.getElementById("matMetalValue");
  // Визуал (диагностика)
  const testPresetToggle = document.getElementById("testPresetToggle");
  const rtQualityToggle = document.getElementById("rtQualityToggle");
  const envToggle = document.getElementById("envToggle");
  const envInt = document.getElementById("envInt");
  const envIntValue = document.getElementById("envIntValue");
  const toneToggle = document.getElementById("toneToggle");
  const exposure = document.getElementById("exposure");
  const exposureValue = document.getElementById("exposureValue");
  const aoToggle = document.getElementById("aoToggle");
  const aoInt = document.getElementById("aoInt");
  const aoIntValue = document.getElementById("aoIntValue");
  const aoRad = document.getElementById("aoRad");
  const aoRadValue = document.getElementById("aoRadValue");
  const dumpVisual = document.getElementById("dumpVisual");
  // Цветокор
  const ccToggle = document.getElementById("ccToggle");
  const ccHue = document.getElementById("ccHue");
  const ccHueValue = document.getElementById("ccHueValue");
  const ccSat = document.getElementById("ccSat");
  const ccSatValue = document.getElementById("ccSatValue");
  const ccBri = document.getElementById("ccBri");
  const ccBriValue = document.getElementById("ccBriValue");
  const ccCon = document.getElementById("ccCon");
  const ccConValue = document.getElementById("ccConValue");

  // ===== Test preset ("Тест") - полностью изолированная настройка =====
  const _testSnapshot = new Map();
  const testSnapshotEl = (el) => {
    if (!el) return;
    _testSnapshot.set(el, {
      checked: "checked" in el ? el.checked : undefined,
      value: "value" in el ? el.value : undefined,
      disabled: "disabled" in el ? el.disabled : undefined,
    });
  };
  const testRestoreEl = (el) => {
    if (!el) return;
    const s = _testSnapshot.get(el);
    if (!s) return;
    if ("checked" in el && typeof s.checked === "boolean") el.checked = s.checked;
    if ("value" in el && typeof s.value === "string") el.value = s.value;
    if ("disabled" in el && typeof s.disabled === "boolean") el.disabled = s.disabled;
  };

  const getAllNonTestControls = () => ([
    // Test preset toggle must stay enabled to allow turning it off
    // Shadows + sun
    shadowToggle, shadowGradToggle, shadowGradLen, shadowGradStr, shadowGradCurve, shadowOpacity, shadowSoft,
    sunToggle, sunHeight,
    // Materials
    matPreset, matRough, matMetal,
    // Visual
    rtQualityToggle, envToggle, envInt, toneToggle, exposure, aoToggle, aoInt, aoRad,
    dumpVisual,
    // Color correction
    ccToggle, ccHue, ccSat, ccBri, ccCon,
  ].filter(Boolean));

  const setDisabled = (el, disabled) => { if (el && "disabled" in el) el.disabled = !!disabled; };

  const applyTestUiLock = (enabled) => {
    getAllNonTestControls().forEach((el) => setDisabled(el, enabled));
    // сам тест-переключатель не блокируем
    if (testPresetToggle) setDisabled(testPresetToggle, false);
  };

  if (testPresetToggle) {
    testPresetToggle.checked = false;
    testPresetToggle.addEventListener("change", (e) => {
      const on = !!e.target.checked;
      if (on) {
        _testSnapshot.clear();
        // снимем снапшот со всех контролов, включая сам test (чтобы вернуть checked), но блокировать его не будем
        [testPresetToggle, ...getAllNonTestControls()].forEach(testSnapshotEl);
        viewer.setTestPresetEnabled?.(true);
        applyTestUiLock(true);
      } else {
        viewer.setTestPresetEnabled?.(false);
        // вернём UI
        [testPresetToggle, ...getAllNonTestControls()].forEach(testRestoreEl);
        applyTestUiLock(false);
      }
    });
  }

  // ===== Realtime-quality preset (UI master toggle) =====
  const _rtSnapshot = new Map();
  const snapshotEl = (el) => {
    if (!el) return;
    _rtSnapshot.set(el, {
      checked: "checked" in el ? el.checked : undefined,
      value: "value" in el ? el.value : undefined,
      disabled: "disabled" in el ? el.disabled : undefined,
    });
  };
  const restoreEl = (el) => {
    if (!el) return;
    const s = _rtSnapshot.get(el);
    if (!s) return;
    if ("checked" in el && typeof s.checked === "boolean") el.checked = s.checked;
    if ("value" in el && typeof s.value === "string") el.value = s.value;
    if ("disabled" in el && typeof s.disabled === "boolean") el.disabled = s.disabled;
  };
  // Важно: делаем это функцией, чтобы не попасть в TDZ для переменных,
  // которые объявляются ниже (например, sunToggle/sunHeight).
  const getRtManagedControls = () => ([
    // Shadows + sun
    shadowToggle, shadowGradToggle, shadowGradLen, shadowGradStr, shadowGradCurve, shadowOpacity, shadowSoft,
    sunToggle, sunHeight,
    // Materials
    matPreset, matRough, matMetal,
    // Visual
    envToggle, envInt, toneToggle, exposure, aoToggle, aoInt, aoRad,
    // Color correction
    ccToggle, ccHue, ccSat, ccBri, ccCon,
  ].filter(Boolean));

  const applyRtQualityUiLock = (enabled) => {
    // Блокируем все ручные контролы, кроме самого переключателя и кнопки dump
    getRtManagedControls().forEach((el) => setDisabled(el, enabled));
  };

  if (rtQualityToggle) {
    rtQualityToggle.checked = false;
    rtQualityToggle.addEventListener("change", (e) => {
      const on = !!e.target.checked;
      if (on) {
        // Снимем UI-снапшот, чтобы вернуть всё как было (включая disabled-состояния)
        _rtSnapshot.clear();
        getRtManagedControls().forEach(snapshotEl);
        snapshotEl(dumpVisual); // dump не блокируем, но состояние тоже сохраним на всякий

        viewer.setRealtimeQualityEnabled(true);
        applyRtQualityUiLock(true);
      } else {
        viewer.setRealtimeQualityEnabled(false);
        // Вернём UI
        getRtManagedControls().forEach(restoreEl);
        restoreEl(dumpVisual);
        applyRtQualityUiLock(false);
      }
    });
  }
  if (shadowToggle) {
    // Дефолт (из текущих подобранных значений)
    shadowToggle.checked = true;
    viewer.setShadowsEnabled(true);
    // синхронизируем тулбар-кнопку, если есть
    const _btn = document.getElementById("ifcToggleShadows");
    if (_btn) _btn.classList.toggle('btn-active', true);
    shadowToggle.addEventListener("change", (e) => {
      const on = !!e.target.checked;
      viewer.setShadowsEnabled(on);
      const btn = document.getElementById("ifcToggleShadows");
      if (btn) btn.classList.toggle('btn-active', on);
      // UI градиента имеет смысл только когда тени включены
      if (shadowGradToggle) shadowGradToggle.disabled = !on;
      if (shadowGradLen) shadowGradLen.disabled = !on;
      if (shadowGradStr) shadowGradStr.disabled = !on;
      if (shadowGradCurve) shadowGradCurve.disabled = !on;
      if (shadowOpacity) shadowOpacity.disabled = !on;
      if (shadowSoft) shadowSoft.disabled = !on;
    });
  }
  // Градиент тени: по умолчанию включён, но элементы блокируем пока тени выключены
  const syncGradUiEnabled = (enabled) => {
    if (shadowGradToggle) shadowGradToggle.disabled = !enabled;
    if (shadowGradLen) shadowGradLen.disabled = !enabled;
    if (shadowGradStr) shadowGradStr.disabled = !enabled;
    if (shadowGradCurve) shadowGradCurve.disabled = !enabled;
    if (shadowOpacity) shadowOpacity.disabled = !enabled;
    if (shadowSoft) shadowSoft.disabled = !enabled;
  };
  syncGradUiEnabled(true);

  if (shadowGradToggle) {
    shadowGradToggle.checked = true;
    viewer.setShadowGradientEnabled(true);
    shadowGradToggle.addEventListener("change", (e) => {
      viewer.setShadowGradientEnabled(!!e.target.checked);
    });
  }
  if (shadowGradLen) {
    shadowGradLen.value = "14.4";
    if (shadowGradLenValue) shadowGradLenValue.textContent = "14.4";
    viewer.setShadowGradientLength(14.4);
    shadowGradLen.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (shadowGradLenValue) shadowGradLenValue.textContent = v.toFixed(1);
      viewer.setShadowGradientLength(v);
    });
  }
  if (shadowGradStr) {
    shadowGradStr.value = "1.00";
    if (shadowGradStrValue) shadowGradStrValue.textContent = "1.00";
    viewer.setShadowGradientStrength(1.0);
    shadowGradStr.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (shadowGradStrValue) shadowGradStrValue.textContent = v.toFixed(2);
      viewer.setShadowGradientStrength(v);
    });
  }

  if (shadowGradCurve) {
    shadowGradCurve.value = "0.50";
    if (shadowGradCurveValue) shadowGradCurveValue.textContent = "0.50";
    viewer.setShadowGradientCurve(0.5);
    shadowGradCurve.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (shadowGradCurveValue) shadowGradCurveValue.textContent = v.toFixed(2);
      viewer.setShadowGradientCurve(v);
    });
  }

  // Полупрозрачность тени на земле
  if (shadowOpacity) {
    shadowOpacity.value = "0.14";
    if (shadowOpacityValue) shadowOpacityValue.textContent = "0.14";
    viewer.setShadowOpacity(0.14);
    shadowOpacity.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (shadowOpacityValue) shadowOpacityValue.textContent = v.toFixed(2);
      viewer.setShadowOpacity(v);
    });
  }

  // Мягкость края тени
  if (shadowSoft) {
    shadowSoft.value = "0.0";
    if (shadowSoftValue) shadowSoftValue.textContent = "0.0";
    viewer.setShadowSoftness(0.0);
    shadowSoft.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (shadowSoftValue) shadowSoftValue.textContent = v.toFixed(1);
      viewer.setShadowSoftness(v);
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
    // Дефолт (из текущих подобранных значений)
    sunHeight.value = "5.9";
    if (sunHeightValue) sunHeightValue.textContent = "5.9";
    viewer.setSunHeight(5.9);
    sunHeight.disabled = !(sunToggle ? !!sunToggle.checked : true);
    sunHeight.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (sunHeightValue) sunHeightValue.textContent = v.toFixed(1);
      viewer.setSunHeight(v);
    });
  }

  // ===== Материалы =====
  const MAT_DEFAULTS = {
    original: { roughness: 0.90, metalness: 0.00, slidersEnabled: false },
    matte: { roughness: 0.90, metalness: 0.00, slidersEnabled: true },
    glossy: { roughness: 0.05, metalness: 0.00, slidersEnabled: true },
    // Важно: "пластик" не должен быть металлом, иначе появятся резкие блики и "дёрганая" картинка при вращении
    plastic: { roughness: 0.65, metalness: 0.00, slidersEnabled: true },
    concrete: { roughness: 0.95, metalness: 0.00, slidersEnabled: true },
  };

  const setMatUiEnabled = (enabled) => {
    if (matRough) matRough.disabled = !enabled;
    if (matMetal) matMetal.disabled = !enabled;
  };

  const applyMatPresetUi = (preset) => {
    const d = MAT_DEFAULTS[preset] || MAT_DEFAULTS.original;
    if (matRough) matRough.value = String(d.roughness.toFixed(2));
    if (matRoughValue) matRoughValue.textContent = d.roughness.toFixed(2);
    if (matMetal) matMetal.value = String(d.metalness.toFixed(2));
    if (matMetalValue) matMetalValue.textContent = d.metalness.toFixed(2);
    setMatUiEnabled(d.slidersEnabled);
  };

  if (matPreset) {
    // Дефолт: Пластик (как на скрине)
    matPreset.value = "plastic";
    applyMatPresetUi("plastic");
    viewer.setMaterialPreset("plastic");
    viewer.setMaterialRoughness(MAT_DEFAULTS.plastic.roughness);
    viewer.setMaterialMetalness(MAT_DEFAULTS.plastic.metalness);
    matPreset.addEventListener("change", (e) => {
      const preset = e.target.value;
      viewer.setMaterialPreset(preset);
      applyMatPresetUi(preset);
      // применяем дефолтные параметры пресета как override
      const d = MAT_DEFAULTS[preset] || MAT_DEFAULTS.original;
      if (d.slidersEnabled) {
        viewer.setMaterialRoughness(d.roughness);
        viewer.setMaterialMetalness(d.metalness);
      } else {
        viewer.setMaterialRoughness(null);
        viewer.setMaterialMetalness(null);
      }
    });
  }

  if (matRough) {
    matRough.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (matRoughValue) matRoughValue.textContent = v.toFixed(2);
      viewer.setMaterialRoughness(v);
    });
  }
  if (matMetal) {
    matMetal.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (matMetalValue) matMetalValue.textContent = v.toFixed(2);
      viewer.setMaterialMetalness(v);
    });
  }

  // ===== Визуал (диагностика) =====
  const syncVisualUiEnabled = () => {
    const envOn = !!(envToggle && envToggle.checked);
    const toneOn = !!(toneToggle && toneToggle.checked);
    const aoOn = !!(aoToggle && aoToggle.checked);
    if (envInt) envInt.disabled = !envOn;
    if (exposure) exposure.disabled = !toneOn;
    if (aoInt) aoInt.disabled = !aoOn;
    if (aoRad) aoRad.disabled = !aoOn;
  };

  const syncCcUiEnabled = () => {
    const on = !!(ccToggle && ccToggle.checked);
    if (ccHue) ccHue.disabled = !on;
    if (ccSat) ccSat.disabled = !on;
    if (ccBri) ccBri.disabled = !on;
    if (ccCon) ccCon.disabled = !on;
  };

  // Дефолты (как на скрине)
  if (envToggle) {
    envToggle.checked = true;
    viewer.setEnvironmentEnabled(true);
    envToggle.addEventListener("change", (e) => {
      viewer.setEnvironmentEnabled(!!e.target.checked);
      syncVisualUiEnabled();
    });
  }
  if (envInt) {
    envInt.value = "0.65";
    if (envIntValue) envIntValue.textContent = "0.65";
    viewer.setEnvironmentIntensity(0.65);
    envInt.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (envIntValue) envIntValue.textContent = v.toFixed(2);
      viewer.setEnvironmentIntensity(v);
    });
  }

  if (toneToggle) {
    toneToggle.checked = true;
    viewer.setToneMappingEnabled(true);
    toneToggle.addEventListener("change", (e) => {
      viewer.setToneMappingEnabled(!!e.target.checked);
      syncVisualUiEnabled();
    });
  }
  if (exposure) {
    exposure.value = "1.11";
    if (exposureValue) exposureValue.textContent = "1.11";
    viewer.setExposure(1.11);
    exposure.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (exposureValue) exposureValue.textContent = v.toFixed(2);
      viewer.setExposure(v);
    });
  }

  if (aoToggle) {
    aoToggle.checked = true;
    viewer.setAOEnabled(true);
    aoToggle.addEventListener("change", (e) => {
      viewer.setAOEnabled(!!e.target.checked);
      syncVisualUiEnabled();
    });
  }
  if (aoInt) {
    aoInt.value = "0.52";
    if (aoIntValue) aoIntValue.textContent = "0.52";
    viewer.setAOIntensity(0.52);
    aoInt.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (aoIntValue) aoIntValue.textContent = v.toFixed(2);
      viewer.setAOIntensity(v);
    });
  }
  if (aoRad) {
    aoRad.value = "8";
    if (aoRadValue) aoRadValue.textContent = "8";
    viewer.setAORadius(8);
    aoRad.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (aoRadValue) aoRadValue.textContent = String(Math.round(v));
      viewer.setAORadius(v);
    });
  }

  syncVisualUiEnabled();

  if (dumpVisual) {
    dumpVisual.addEventListener("click", () => viewer.dumpVisualDebug());
  }

  // ===== Цветокор =====
  if (ccToggle) {
    ccToggle.checked = false;
    viewer.setColorCorrectionEnabled(false);
    ccToggle.addEventListener("change", (e) => {
      viewer.setColorCorrectionEnabled(!!e.target.checked);
      syncCcUiEnabled();
    });
  }
  if (ccHue) {
    ccHue.value = "0.00";
    if (ccHueValue) ccHueValue.textContent = "0.00";
    viewer.setColorHue(0.0);
    ccHue.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (ccHueValue) ccHueValue.textContent = v.toFixed(2);
      viewer.setColorHue(v);
    });
  }
  if (ccSat) {
    ccSat.value = "0.00";
    if (ccSatValue) ccSatValue.textContent = "0.00";
    viewer.setColorSaturation(0.0);
    ccSat.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (ccSatValue) ccSatValue.textContent = v.toFixed(2);
      viewer.setColorSaturation(v);
    });
  }
  if (ccBri) {
    ccBri.value = "0.00";
    if (ccBriValue) ccBriValue.textContent = "0.00";
    viewer.setColorBrightness(0.0);
    ccBri.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (ccBriValue) ccBriValue.textContent = v.toFixed(2);
      viewer.setColorBrightness(v);
    });
  }
  if (ccCon) {
    ccCon.value = "0.00";
    if (ccConValue) ccConValue.textContent = "0.00";
    viewer.setColorContrast(0.0);
    ccCon.addEventListener("input", (e) => {
      const v = Number(e.target.value);
      if (ccConValue) ccConValue.textContent = v.toFixed(2);
      viewer.setColorContrast(v);
    });
  }
  syncCcUiEnabled();
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
  // Нижний тулбар пакета (index.html): Edges
  const toggleEdges = document.getElementById("ifcToggleEdges");
  // Нижний тулбар пакета (index.html): Shadows
  const toggleShadowsBtn = document.getElementById("ifcToggleShadows");
  // Нижний тулбар пакета (index.html): Projection (Perspective/Ortho)
  const toggleProjectionBtn = document.getElementById("ifcToggleProjection");
  const toggleShading = document.getElementById("toggleShading");
  // Нижний тулбар пакета (index.html): секущие плоскости
  const clipXBtn = document.getElementById("ifcClipX");
  const clipYBtn = document.getElementById("ifcClipY");
  const clipZBtn = document.getElementById("ifcClipZ");
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

  // Переключение вида: "без перспективы" (Ortho) ↔ Perspective
  // Вариант 2: на кнопке показываем действие (альтернативный режим)
  const PROJ_ICON_PERSPECTIVE = `
    <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="currentColor" style="color:#252A3F">
      <path d="M 365.50 333.29 A 0.30 0.30 0.0 0 0 365.95 333.55 L 492.36 259.80 A 0.47 0.47 0.0 0 0 492.51 259.12 Q 489.74 255.31 492.90 252.78 A 0.30 0.30 0.0 0 0 492.83 252.27 C 489.14 250.57 490.13 245.43 493.90 244.50 C 496.33 243.90 501.93 247.88 504.97 249.79 A 1.50 1.48 -85.3 0 1 505.54 250.47 L 505.97 251.53 A 0.72 0.71 76.6 0 0 506.67 251.97 C 509.70 251.84 512.28 254.84 511.15 257.67 Q 510.77 258.62 508.18 260.14 C 355.38 349.68 251.70 410.06 149.28 469.74 A 3.94 3.93 -44.9 0 1 145.31 469.74 Q 7.70 389.45 2.96 386.69 C 0.09 385.02 0.50 382.93 0.50 379.49 Q 0.50 259.79 0.50 128.77 C 0.50 127.21 1.85 125.96 3.27 125.13 Q 68.02 87.24 145.61 41.87 C 146.90 41.11 148.92 41.81 150.33 42.63 Q 219.34 82.64 289.83 124.16 C 291.25 125.00 292.80 126.11 294.76 127.15 Q 299.89 129.89 301.84 131.37 C 305.49 134.15 301.99 140.40 297.26 138.18 Q 295.67 137.42 294.41 136.58 A 0.26 0.26 0.0 0 0 294.00 136.80 L 294.00 209.83 A 0.44 0.44 0.0 0 0 294.36 210.26 Q 340.50 219.23 361.26 223.22 C 366.12 224.15 365.53 227.44 365.51 232.03 Q 365.50 234.52 365.49 251.11 A 0.73 0.73 0.0 0 0 366.22 251.84 L 370.02 251.84 A 3.64 3.64 0.0 0 1 373.66 255.48 L 373.66 256.72 A 3.45 3.44 0.0 0 1 370.21 260.16 L 366.15 260.16 A 0.65 0.65 0.0 0 0 365.50 260.81 L 365.50 333.29 Z M 9.05 131.40 A 0.30 0.30 0.0 0 0 8.90 131.66 L 8.90 380.18 A 0.30 0.30 0.0 0 0 9.05 380.44 L 142.74 458.43 A 0.30 0.30 0.0 0 0 143.19 458.17 L 143.19 53.67 A 0.30 0.30 0.0 0 0 142.74 53.41 L 9.05 131.40 Z M 285.68 380.52 A 0.32 0.32 0.0 0 0 285.84 380.25 L 285.84 131.66 A 0.32 0.32 0.0 0 0 285.68 131.39 L 151.98 53.39 A 0.32 0.32 0.0 0 0 151.50 53.67 L 151.50 458.24 A 0.32 0.32 0.0 0 0 151.98 458.52 L 285.68 380.52 Z M 294.62 218.77 A 0.36 0.36 0.0 0 0 294.19 219.13 L 294.19 374.90 A 0.36 0.36 0.0 0 0 294.73 375.21 L 357.13 338.81 A 0.36 0.36 0.0 0 0 357.31 338.50 L 357.31 231.30 A 0.36 0.36 0.0 0 0 357.02 230.94 L 294.62 218.77 Z"/>
      <path d="M 331.8028 153.6467 A 4.00 4.00 0.0 0 1 326.3286 155.0726 L 318.9110 150.7207 A 4.00 4.00 0.0 0 1 317.4851 145.2465 L 317.6572 144.9533 A 4.00 4.00 0.0 0 1 323.1314 143.5274 L 330.5490 147.8793 A 4.00 4.00 0.0 0 1 331.9749 153.3535 L 331.8028 153.6467 Z"/>
      <path d="M 360.6890 170.5463 A 4.00 4.00 0.0 0 1 355.2099 171.9531 L 347.8247 167.5855 A 4.00 4.00 0.0 0 1 346.4179 162.1064 L 346.5910 161.8137 A 4.00 4.00 0.0 0 1 352.0701 160.4069 L 359.4553 164.7745 A 4.00 4.00 0.0 0 1 360.8621 170.2536 L 360.6890 170.5463 Z"/>
      <path d="M 389.5811 187.4643 A 3.99 3.99 0.0 0 1 384.1181 188.8771 L 376.8287 184.5833 A 3.99 3.99 0.0 0 1 375.4159 179.1204 L 375.6189 178.7757 A 3.99 3.99 0.0 0 1 381.0819 177.3629 L 388.3713 181.6567 A 3.99 3.99 0.0 0 1 389.7841 187.1196 L 389.5811 187.4643 Z"/>
      <path d="M 418.5914 204.3586 A 3.99 3.99 0.0 0 1 413.1235 205.7523 L 405.7288 201.3617 A 3.99 3.99 0.0 0 1 404.3350 195.8938 L 404.5086 195.6014 A 3.99 3.99 0.0 0 1 409.9765 194.2077 L 417.3712 198.5983 A 3.99 3.99 0.0 0 1 418.7650 204.0662 L 418.5914 204.3586 Z"/>
      <path d="M 447.6480 221.1624 A 3.99 3.99 0.0 0 1 442.2027 222.6419 L 434.7225 218.3579 A 3.99 3.99 0.0 0 1 433.2431 212.9126 L 433.4120 212.6176 A 3.99 3.99 0.0 0 1 438.8573 211.1381 L 446.3375 215.4221 A 3.99 3.99 0.0 0 1 447.8169 220.8674 L 447.6480 221.1624 Z"/>
      <path d="M 476.5002 238.1477 A 3.99 3.99 0.0 0 1 471.0372 239.5605 L 463.6099 235.1855 A 3.99 3.99 0.0 0 1 462.1971 229.7225 L 462.3798 229.4123 A 3.99 3.99 0.0 0 1 467.8428 227.9995 L 475.2701 232.3745 A 3.99 3.99 0.0 0 1 476.6829 237.8375 L 476.5002 238.1477 Z"/>
      <path d="M 407.4604 256.3255 A 3.98 3.98 0.0 0 1 403.4873 260.3125 L 394.8874 260.3275 A 3.98 3.98 0.0 0 1 390.9004 256.3545 L 390.8996 255.8945 A 3.98 3.98 0.0 0 1 394.8727 251.9075 L 403.4726 251.8925 A 3.98 3.98 0.0 0 1 407.4596 255.8655 L 407.4604 256.3255 Z"/>
      <path d="M 440.9596 256.3545 A 3.98 3.98 0.0 0 1 436.9726 260.3275 L 428.3727 260.3125 A 3.98 3.98 0.0 0 1 424.3996 256.3255 L 424.4004 255.8655 A 3.98 3.98 0.0 0 1 428.3874 251.8925 L 436.9873 251.9075 A 3.98 3.98 0.0 0 1 440.9604 255.8945 L 440.9596 256.3545 Z"/>
      <path d="M 474.4604 256.3255 A 3.98 3.98 0.0 0 1 470.4873 260.3125 L 461.8874 260.3275 A 3.98 3.98 0.0 0 1 457.9004 256.3545 L 457.8996 255.8945 A 3.98 3.98 0.0 0 1 461.8727 251.9075 L 470.4726 251.8925 A 3.98 3.98 0.0 0 1 474.4596 255.8655 L 474.4604 256.3255 Z"/>
    </svg>
  `;
  const PROJ_ICON_ORTHO = `
    <svg width="24" height="24" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="currentColor" style="color:#252A3F">
      <path d="M 256.02 48.55 Q 257.33 48.55 258.06 48.94 Q 381.49 115.11 442.91 148.14 Q 445.24 149.39 445.26 152.25 Q 445.52 184.71 445.52 256.00 Q 445.52 327.29 445.26 359.75 Q 445.24 362.61 442.91 363.86 Q 381.49 396.89 258.06 463.06 Q 257.33 463.45 256.02 463.45 Q 254.71 463.45 253.98 463.06 Q 130.55 396.89 69.13 363.86 Q 66.80 362.61 66.78 359.75 Q 66.52 327.29 66.52 256.00 Q 66.52 184.71 66.78 152.25 Q 66.80 149.39 69.13 148.14 Q 130.55 115.11 253.98 48.94 Q 254.71 48.55 256.02 48.55 Z M 256.03 147.56 Q 257.36 147.56 258.05 147.94 Q 295.68 168.96 347.89 198.33 A 0.77 0.75 44.3 0 0 348.62 198.33 L 429.62 152.89 A 0.32 0.32 0.0 0 0 429.62 152.33 Q 332.33 100.05 256.30 59.37 Q 256.25 59.35 256.15 59.34 Q 256.09 59.33 256.02 59.33 Q 255.97 59.33 255.90 59.34 Q 255.81 59.35 255.76 59.37 Q 179.73 100.05 82.44 152.34 A 0.32 0.32 0.0 0 0 82.44 152.90 L 163.44 198.34 A 0.77 0.75 -44.3 0 0 164.17 198.34 Q 216.38 168.96 254.01 147.94 Q 254.70 147.56 256.03 147.56 Z M 255.82 250.17 A 0.38 0.38 0.0 0 0 256.20 250.17 L 337.45 204.58 A 0.38 0.38 0.0 0 0 337.45 203.92 L 256.20 158.33 A 0.38 0.38 0.0 0 0 255.82 158.33 L 174.57 203.92 A 0.38 0.38 0.0 0 0 174.57 204.58 L 255.82 250.17 Z M 76.99 161.29 A 0.33 0.33 0.0 0 0 76.50 161.58 L 76.50 246.92 A 0.33 0.33 0.0 0 0 76.99 247.21 L 153.06 204.54 A 0.33 0.33 0.0 0 0 153.06 203.96 L 76.99 161.29 Z M 434.97 247.14 A 0.35 0.35 0.0 0 0 435.49 246.83 L 435.49 161.67 A 0.35 0.35 0.0 0 0 434.97 161.36 L 359.05 203.94 A 0.35 0.35 0.0 0 0 359.05 204.56 L 434.97 247.14 Z M 245.33 256.28 A 0.32 0.32 0.0 0 0 245.33 255.72 L 163.96 210.07 A 0.32 0.32 0.0 0 0 163.64 210.07 L 82.27 255.72 A 0.32 0.32 0.0 0 0 82.27 256.28 L 163.64 301.93 A 0.32 0.32 0.0 0 0 163.96 301.93 L 245.33 256.28 Z M 429.83 256.28 A 0.32 0.32 0.0 0 0 429.83 255.72 L 348.46 210.07 A 0.32 0.32 0.0 0 0 348.14 210.07 L 266.77 255.72 A 0.32 0.32 0.0 0 0 266.77 256.28 L 348.14 301.93 A 0.32 0.32 0.0 0 0 348.46 301.93 L 429.83 256.28 Z M 337.56 308.04 A 0.33 0.33 0.0 0 0 337.56 307.46 L 256.20 261.82 A 0.33 0.33 0.0 0 0 255.88 261.82 L 174.51 307.46 A 0.33 0.33 0.0 0 0 174.51 308.04 L 255.87 353.68 A 0.33 0.33 0.0 0 0 256.19 353.68 L 337.56 308.04 Z M 76.96 264.77 A 0.31 0.31 0.0 0 0 76.50 265.04 L 76.50 350.46 A 0.31 0.31 0.0 0 0 76.96 350.73 L 153.09 308.02 A 0.31 0.31 0.0 0 0 153.09 307.48 L 76.96 264.77 Z M 434.97 350.63 A 0.35 0.35 0.0 0 0 435.49 350.33 L 435.49 265.17 A 0.35 0.35 0.0 0 0 434.97 264.87 L 359.05 307.44 A 0.35 0.35 0.0 0 0 359.05 308.06 L 434.97 350.63 Z M 256.02 364.45 Q 254.69 364.45 254.00 364.06 Q 216.37 343.04 164.17 313.67 A 0.77 0.75 44.3 0 0 163.44 313.67 L 82.44 359.10 A 0.32 0.32 0.0 0 0 82.44 359.66 Q 179.72 411.94 255.74 452.63 Q 255.79 452.65 255.89 452.66 Q 255.96 452.67 256.00 452.67 Q 256.07 452.67 256.14 452.66 Q 256.24 452.65 256.29 452.63 Q 332.31 411.95 429.60 359.67 A 0.32 0.32 0.0 0 0 429.60 359.11 L 348.60 313.68 A 0.77 0.75 -44.3 0 0 347.87 313.68 Q 295.66 343.04 258.03 364.06 Q 257.35 364.45 256.02 364.45 Z"/>
    </svg>
  `;
  const syncProjectionIcon = () => {
    if (!toggleProjectionBtn) return;
    const mode = viewer.getProjectionMode?.() || 'perspective';
    toggleProjectionBtn.innerHTML = (mode === 'perspective') ? PROJ_ICON_ORTHO : PROJ_ICON_PERSPECTIVE;
  };
  syncProjectionIcon();
  toggleProjectionBtn?.addEventListener("click", () => {
    viewer.toggleProjection?.();
    syncProjectionIcon();
  });

  // Тени по умолчанию включены (как и в левой панели)
  const setToolbarShadowsActive = (on) => {
    if (toggleShadowsBtn) toggleShadowsBtn.classList.toggle('btn-active', !!on);
  };
  setToolbarShadowsActive(true);
  toggleShadowsBtn?.addEventListener("click", () => {
    const next = !(shadowToggle ? !!shadowToggle.checked : true);
    // Меняем состояние у Viewer
    viewer.setShadowsEnabled(next);
    // Синхронизируем UI слева, если он есть
    if (shadowToggle) shadowToggle.checked = next;
    setToolbarShadowsActive(next);
  });

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