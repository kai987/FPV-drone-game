import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createUrbanWorld } from '../src/game/urban-world.ts';
import { getMapSpec } from '../src/game/map-catalog.ts';
import { getMapLayout } from '../src/game/map-layout.ts';
import type { RustRuntime } from '../src/game/rust-runtime.ts';
import type { WorldKernel } from '../src/game/world-kernel.ts';

// Only the sign's Canvas pixels require a DOM; geometry, lights and distance
// visibility are the real Three.js objects used by the production world.
function world(mapId: 'factory' | 'harbor') {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(name: string) {
      assert.equal(name, 'canvas');
      return { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText() {} }) };
    },
  } });
  try {
    return createUrbanWorld({} as RustRuntime, { surfaceHeight: () => 2 } as WorldKernel, getMapSpec(mapId));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

for (const mapId of ['factory', 'harbor'] as const) {
  test(`${mapId} remote district detail appears when approached, with a bounded night light pool`, () => {
    const scenery = world(mapId);
    try {
      const chunks: THREE.InstancedMesh[] = [], lights: THREE.PointLight[] = [];
      scenery.scene.traverse(object => {
        if (object instanceof THREE.InstancedMesh && object.name === 'Industrial surface details') chunks.push(object);
        if (object instanceof THREE.PointLight) lights.push(object);
      });
      assert.ok(chunks.length > 10, 'districts have independently cullable detail geometry');
      assert.equal(lights.length, mapId === 'harbor' ? 9 : 8, 'larger street grids cannot multiply shader lights');
      scenery.setNight(true);
      scenery.update(0, 0, { x: 0, y: 12, z: 55 }, { x: 0, y: 14, z: 62 });
      const hidden = chunks.filter(chunk => !chunk.visible);
      assert.ok(hidden.length > chunks.length / 2, 'remote detail is not submitted from the start area');
      const remoteWarehouse = getMapLayout(mapId).warehouses.find(warehouse => warehouse.z < -2500)!;
      assert.ok(remoteWarehouse);
      const position = { x: remoteWarehouse.x, y: remoteWarehouse.base + remoteWarehouse.height + 15, z: remoteWarehouse.z };
      scenery.update(1, 0, position, position);
      assert.ok(hidden.some(chunk => chunk.visible), 'travelling beyond the former boundary reveals the regional details');
      scenery.setNight(false); scenery.update(2, 0, position, position);
      assert.ok(lights.every(light => light.intensity === 0), 'daytime disables the local street and lighthouse lights');
    } finally { scenery.dispose(); }
  });

  test(`${mapId} can release all regional instances and shared geometry/material/texture resources once`, () => {
    const scenery = world(mapId);
    const resources = new Map<THREE.EventDispatcher<{ dispose: {} }>, number>();
    const watch = (resource: THREE.BufferGeometry | THREE.Material | THREE.Texture) => {
      if (resources.has(resource)) return;
      resources.set(resource, 0);
      resource.addEventListener('dispose', () => { resources.set(resource, resources.get(resource)! + 1); });
    };
    scenery.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        watch(object.geometry);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          watch(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) watch(value);
        }
      }
    });
    assert.ok(resources.size > 30);
    scenery.dispose(); scenery.dispose();
    assert.equal(scenery.scene.children.length, 0);
    assert.ok([...resources.values()].every(count => count === 1), 'shared resources are neither leaked nor disposed by each regional batch');
  });
}

test('all four harbor ships render at the authored metre positions with hull and deck elevations matching Rust boxes', () => {
  const scenery = world('harbor');
  try {
    const ships = getMapLayout('harbor').ships;
    const hulls = scenery.scene.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh && object.name.startsWith('Cargo ship '));
    assert.equal(hulls.length, 4);
    for (const ship of ships) {
      const hull = hulls.find(mesh => mesh.name === `Cargo ship ${ship.name}`)!;
      assert.ok(hull);
      assert.deepEqual(hull.position.toArray(), [ship.x, ship.deckY, ship.z]);
      hull.geometry.computeBoundingBox();
      const bounds = hull.geometry.boundingBox!;
      const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
      near(bounds.max.x - bounds.min.x, ship.width);
      near(bounds.max.z - bounds.min.z, ship.length);
      near(bounds.min.y + hull.position.y, -8);
      near(bounds.max.y + hull.position.y, ship.deckY);
    }
  } finally { scenery.dispose(); }
});
