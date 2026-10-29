import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getExplorationLayout } from '../src/game/exploration-layout.ts';
import { getDowntownBuildingParts, getDowntownRoofDetails } from '../src/game/downtown-architecture.ts';
import { createDowntownBuildings } from '../src/game/downtown-buildings.ts';

test('the existing city lots produce seven distinct structural archetypes while keeping streets open', () => {
  const buildings = getExplorationLayout('downtown').buildings;
  const types = new Set(buildings.map(building => getDowntownBuildingParts(building).archetype));
  assert.equal(buildings.length, 198);
  assert.equal(types.size, 7);
  for (const building of buildings) {
    const parts = getDowntownBuildingParts(building), top = getDowntownRoofDetails(building);
    assert.ok(parts.bodies.length >= 2, 'architecture has a podium and a different upper silhouette');
    assert.ok(parts.solids.every(part => [part.x, part.z, part.base, part.height, part.width, part.depth].every(Number.isFinite)
      && part.width > 0 && part.depth > 0 && part.height > 0));
    for (const part of parts.solids) {
      assert.ok(Math.abs(part.x - building.x) + part.width / 2 <= building.width / 2 + 0.31);
      assert.ok(Math.abs(part.z - building.z) + part.depth / 2 <= building.depth / 2 + 0.31);
    }
    assert.ok(Math.abs(top.cap.base - building.base - building.height) < 1e-8);
    assert.equal(top.hvac.base, top.cap.base + top.cap.height);
    assert.equal(parts.solids.length, parts.bodies.length + parts.caps.length + 1 + Number(Boolean(parts.antenna)));
    assert.deepEqual(getDowntownBuildingParts(building), parts, 'structure selection is deterministic');
  }
});

test('real Three.js city batches represent structural pieces and release their owned resources once', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const scene = new THREE.Scene(), retained = new THREE.Group(); scene.add(retained);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(name: string) {
      assert.equal(name, 'canvas');
      return { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText() {} }) };
    },
  } });
  let city: ReturnType<typeof createDowntownBuildings>;
  try { city = createDowntownBuildings(scene, getExplorationLayout('downtown').buildings); }
  finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); }
  const meshes: THREE.InstancedMesh[] = [];
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const boxes: { x: number; y: number; z: number; width: number; height: number; depth: number }[] = [];
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  city.group.traverse(object => {
    if (!(object instanceof THREE.InstancedMesh)) return;
    meshes.push(object); geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (!(object.geometry instanceof THREE.BoxGeometry)) return;
    for (let index = 0; index < object.count; index++) {
      object.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale);
      boxes.push({ x: position.x, y: position.y, z: position.z, width: scale.x, height: scale.y, depth: scale.z });
    }
  });
  assert.ok(meshes.length < 60, `architecture uses ${meshes.length} batches`);
  assert.ok(boxes.length < 20_000, 'detail remains instanced rather than adding individual windows');
  const representatives = new Map(getExplorationLayout('downtown').buildings.map(building => [getDowntownBuildingParts(building).archetype, building]));
  for (const building of representatives.values()) for (const part of getDowntownBuildingParts(building).solids) {
    if (part.width < 1) continue; // Antenna uses a round cylinder inside its conservative native box.
    assert.ok(boxes.some(box => Math.abs(box.x - part.x) < 0.002 && Math.abs(box.z - part.z) < 0.002
      && Math.abs(box.y - part.base - part.height / 2) < 0.002 && Math.abs(box.width - part.width) < 0.002
      && Math.abs(box.height - part.height) < 0.002 && Math.abs(box.depth - part.depth) < 0.002), 'native structural piece also exists in the rendered model');
  }
  let releasedGeometry = 0, releasedMaterial = 0, releasedTexture = 0;
  geometries.forEach(value => value.addEventListener('dispose', () => releasedGeometry++));
  materials.forEach(value => value.addEventListener('dispose', () => releasedMaterial++));
  textures.forEach(value => value.addEventListener('dispose', () => releasedTexture++));
  city.setNight(true); city.update(10); city.setNight(false); city.dispose(); city.dispose();
  assert.deepEqual(scene.children, [retained]);
  assert.equal(releasedGeometry, geometries.size); assert.equal(releasedMaterial, materials.size); assert.equal(releasedTexture, textures.size);
});
