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