// Патч совместимости для Three.js 0.149+ и web-ifc-three
// web-ifc-three ожидает mergeGeometries, но в новой версии Three.js его нет

import * as THREE from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Создаем совместимую функцию mergeGeometries
function createMergeGeometries() {
  return function mergeGeometries(geometries, useGroups = false) {
    if (!Array.isArray(geometries) || geometries.length === 0) return null;
    const prepared = [];
    for (const g of geometries) {
      if (!g) continue;
      const geom = g.isBufferGeometry ? g : new THREE.BufferGeometry().copy(g);
      // Гарантируем наличие индекса, иначе mergeBufferGeometries может падать
      if (!geom.index) {
        const position = geom.getAttribute('position');
        if (!position) continue;
        const count = position.count;
        const IndexArray = count > 65535 ? Uint32Array : Uint16Array;
        const indices = new IndexArray(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        geom.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      prepared.push(geom);
    }
    if (prepared.length === 0) {
      const empty = new THREE.BufferGeometry();
      empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      empty.setIndex(new THREE.BufferAttribute(new Uint16Array(0), 1));
      return empty;
    }
    const merged = mergeBufferGeometries(prepared, useGroups);
    if (merged) return merged;
    const fallback = new THREE.BufferGeometry();
    fallback.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    fallback.setIndex(new THREE.BufferAttribute(new Uint16Array(0), 1));
    return fallback;
  };
}

// Экспортируем совместимую функцию
export const mergeGeometries = createMergeGeometries();
export { mergeBufferGeometries };

// Патчим глобальный THREE если доступен
if (typeof window !== 'undefined' && window.THREE) {
  try {
    const BufferGeometryUtils = window.THREE.BufferGeometryUtils || {};
    if (!BufferGeometryUtils.mergeGeometries) {
      BufferGeometryUtils.mergeGeometries = mergeGeometries;
      window.THREE.BufferGeometryUtils = BufferGeometryUtils;
      console.log('✅ Three.js патч: mergeGeometries добавлен в глобальный THREE');
    }
  } catch (error) {
    console.warn('Three.js патч: не удалось применить к глобальному THREE:', error.message);
  }
}
