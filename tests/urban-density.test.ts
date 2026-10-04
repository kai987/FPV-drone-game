import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getDroneSpec } from '../src/game/drone-catalog.ts';
import { createFlightState } from '../src/game/flight.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { getMapSpec } from '../src/game/map-catalog.ts';
import { getMapLayout, HARBOR_SHORE_X } from '../src/game/map-layout.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { getUrbanRoadNetwork } from '../src/game/urban-roads.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const original = {
  factory: { buildings: 48, boxes: 1694, containers: 1023, trucks: 40, landmarks: 89 },
  harbor: { buildings: 21, boxes: 3277, containers: 2932, trucks: 27, landmarks: 35 },
};
interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number; }
function bounds(box: { x: number; z: number; width: number; depth: number; yaw?: number }, margin = 0): Bounds {
  const c = Math.abs(Math.cos(box.yaw ?? 0)), s = Math.abs(Math.sin(box.yaw ?? 0));
  const x = (box.width * c + box.depth * s) / 2 + margin;
  const z = (box.depth * c + box.width * s) / 2 + margin;
  return { minX: box.x - x, maxX: box.x + x, minZ: box.z - z, maxZ: box.z + z };
}
function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX - 1e-8 && a.maxX > b.minX + 1e-8
    && a.minZ < b.maxZ - 1e-8 && a.maxZ > b.minZ + 1e-8;
}
function contains(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.minX + 1e-8 && a.maxX >= b.maxX - 1e-8
    && a.minZ <= b.minZ + 1e-8 && a.maxZ >= b.maxZ - 1e-8;
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

for (const mapId of ['factory', 'harbor'] as const) {
  const layout = getMapLayout(mapId), added = layout.warehouses.slice(original[mapId].buildings);

  test(`${mapId} fills the visible core and distant street blocks with varied, metre-scaled buildings`, () => {
    const [min, max] = mapId === 'factory' ? [150, 220] : [90, 150];
    assert.ok(layout.warehouses.length >= min && layout.warehouses.length <= max);
    const core = layout.warehouses.filter(building => Math.abs(building.x) < 1200 && building.z > -1600 && building.z < 600);
    const forwardCore = core.filter(building => building.z < 0);
    assert.ok(core.length >= (mapId === 'factory' ? 75 : 40), 'density increases in the starting street blocks');
    assert.ok(forwardCore.length >= (mapId === 'factory' ? 50 : 26), 'buildings also fill the flight direction, beyond the spawn');
    const distant = added.filter(building => Math.abs(building.x) > 1800 || building.z < -1800 || building.z > 600);
    assert.ok(distant.length >= (mapId === 'factory' ? 40 : 30), 'infill is distributed beyond the original training area');
    for (const isNorth of [false, true]) for (const isWest of [false, true]) {
      const district = distant.filter(building => (building.z < -1800) === isNorth
        && (building.x < (mapId === 'factory' ? 0 : -1600)) === isWest);
      assert.ok(district.length >= 4, `distant ${isNorth ? 'north' : 'south'} ${isWest ? 'west' : 'east'} district remains occupied`);
    }
    assert.equal(new Set(added.map(building => building.color)).size, 6);
    assert.equal(new Set(added.map(building => building.height)).size, 6);
    assert.ok(new Set(added.map(building => `${building.width}/${building.depth}`)).size >= 4);
    assert.ok(added.every(building => building.width >= 60 && building.width <= 110 && building.depth >= 80
      && building.depth <= 140 && building.height >= 12 && building.height <= 32 && building.base === 2));
    assert.ok(added.every(building => new RegExp(`^(NORTH|SOUTH) ${mapId === 'factory' ? 'WORKS' : 'TERMINAL'} \\d+$`).test(building.label)));
    assert.equal(new Set(layout.warehouses.map(building => building.label)).size, layout.warehouses.length);
  });

  test(`${mapId} keeps loading aprons clear of roads, footways, existing cargo and other buildings`, () => {
    const roads = getUrbanRoadNetwork(mapId), map = getMapSpec(mapId);
    for (const building of added) {
      const apron = bounds(building, 16), roof = bounds(building, 0.71), top = building.base + building.height;
      // The body, roof and four HVAC parts intentionally share the same footprint.
      const own = new Set(layout.boxes.filter(box => box === building
        || box.base >= top && box.base + box.height <= top + 5.1 + 1e-8 && contains(roof, bounds(box))));
      assert.equal(own.size, 6, `${building.label} retains matching roof and rooftop collision geometry`);
      for (const box of layout.boxes) if (!own.has(box)) assert.equal(overlaps(apron, bounds(box)), false,
        `${building.label} apron conflicts with an existing solid at ${box.x}/${box.z}`);
      for (const other of layout.warehouses) if (other !== building) assert.equal(overlaps(apron, bounds(other, 16)), false,
        `${building.label} and ${other.label} need space for both loading aprons`);
      for (const road of [...roads.surfaces, ...roads.kerbs]) assert.equal(overlaps(apron, bounds(road)), false,
        `${building.label} loading area extends onto a road or footway`);
      assert.ok(apron.minX >= map.bounds.minX && apron.maxX <= (mapId === 'harbor' ? HARBOR_SHORE_X : map.bounds.maxX)
        && apron.minZ >= map.bounds.minZ && apron.maxZ <= map.bounds.maxZ,
      'the entire building and loading apron remain on playable dry ground');
    }
  });

  test(`${mapId} adds shared collision geometry and minimap landmarks without multiplying cargo resources`, () => {
    assert.equal(layout.containers.length, original[mapId].containers);
    assert.equal(layout.trucks.length, original[mapId].trucks);
    assert.equal(layout.boxes.length, original[mapId].boxes + added.length * 6);
    assert.equal(layout.landmarks.length, original[mapId].landmarks + added.length);
    assert.ok(layout.boxes.length < 4500 && layout.containers.length < 3000);
    assert.equal(getUrbanRoadNetwork(mapId).intersections.length, 21);
    for (const building of added) {
      assert.ok(layout.boxes.includes(building), `${building.label} is uploaded as a native collision solid`);
      assert.ok(layout.landmarks.some(mark => mark.kind === 'warehouse' && mark.label === building.label
        && mark.x === building.x && mark.z === building.z), `${building.label} appears at the same minimap position`);
    }
    // The original training blocks and outer grid keep their authored positions.
    assert.deepEqual(layout.warehouses[0], mapId === 'factory'
      ? { x: -87, z: -90, width: 78, depth: 112, base: 2, height: 16, color: '#63747a', label: 'ASSEMBLY 01' }
      : { x: -87, z: -125, width: 82, depth: 122, base: 2, height: 16, color: '#748c8e', label: 'PORT STORAGE 01' });
    const columns = mapId === 'factory' ? [-2850, -2050, -800, 800, 2050, 2850] : [-2850, -1850, -600];
    const rows = mapId === 'factory' ? [-3650, -2800, -2100, 900, 1750, 2520] : [-3700, -2850, -2100, 900, 1750, 2520];
    assert.deepEqual(layout.warehouses.slice(mapId === 'factory' ? 12 : 3, original[mapId].buildings)
      .map(building => [building.x, building.z]), rows.flatMap(z => columns.map(x => [x, z])));
  });

  test(`${mapId} infill buildings block real Rust flight and intercept bombs on their rendered roofs`, () => {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, mapId);
    const flight = createWorldFlightSimulation(runtime, world.handle), weapons = createWeaponSimulation(runtime, world);
    try {
      for (const building of added) {
        assert.equal(world.isWater(building.x, building.z), false);
        assert.equal(world.intersectsObstacle({ x: building.x, z: building.z, y: building.base + building.height / 2 }), true);
        near(world.surfaceHeight(building.x, building.z), building.base + building.height + 0.34);
      }
      for (const building of [added[0], added.find(building => building.z < -1800)!]) {
        const state = createFlightState({ x: building.x - building.width / 2 - 8, z: building.z,
          y: building.base + building.height / 2 });
        assert.equal(world.intersectsObstacle(state.position), false, 'building approach starts in clear air');
        let collided = false;
        for (let frame = 0; frame < 120 && !collided; frame++) {
          const result = flight.step(state, { forward: 0, strafe: 1, climb: 0, yaw: 0 }, 1 / 60, 'assisted',
            getDroneSpec('freestyle').flight, { strength: 'calm', direction: 0 }, frame / 60, getMapSpec(mapId).bounds);
          collided = result.obstacleContact;
          assert.equal(result.boundaryContact, false);
        }
        assert.equal(collided, true, `${building.label} blocks normal flight inputs`);
        assert.ok(state.position.x < building.x - building.width / 2);
        const top = building.base + building.height + 0.34;
        assert.equal(weapons.drop({ x: building.x, z: building.z, y: top + 18 }, { x: 0, y: 0, z: 0 }), true);
        let impacts = 0;
        for (let frame = 0; frame < 600 && !impacts; frame++) impacts += weapons.step(1 / 60).impacts;
        assert.equal(impacts, 1, `${building.label} stops the bomb above ground`);
        near(weapons.state.explosions.at(-1)!.position.y, top);
      }
    } finally { weapons.dispose(); flight.dispose(); world.dispose(); }
  });
}

test('urban infill leaves the valley without industrial layout geometry', () => {
  const valley = getMapLayout('valley');
  assert.deepEqual(valley.boxes, []);
  assert.deepEqual(valley.warehouses, []);
  assert.deepEqual(valley.landmarks, []);
});
