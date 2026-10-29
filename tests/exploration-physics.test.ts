import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DESERT_MESAS, DOWNTOWN_STREETS, MOUNTAIN_PEAKS, buildingRoofDetails, explorationGroundHeight, getExplorationLayout } from '../src/game/exploration-layout.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { createFlightState } from '../src/game/flight.ts';
import { getDroneSpec } from '../src/game/drone-catalog.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { getDowntownBuildingParts } from '../src/game/downtown-architecture.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const ids = ['desert', 'downtown', 'mountains'] as const;
const samples = Array.from({ length: 1481 }, (_, index) => ({ x: -2400 + index * 1547 % 4801, z: -2400 + index * 2347 % 4801 }));
function near(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} differs from ${expected}`);
}

for (const id of ids) {
  test(`${id} Rust terrain matches the independent scene reference across the complete flying envelope`, () => {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, id);
    try {
      const points = [...samples, ...DESERT_MESAS, ...MOUNTAIN_PEAKS];
      const packed = new Float64Array(points.flatMap(point => [point.x, point.z]));
      const batch = world.sampleTerrain(packed);
      points.forEach(({ x, z }, index) => {
        const expected = explorationGroundHeight(id, x, z);
        near(world.groundHeight(x, z), expected, `${id} height ${x}/${z}`);
        assert.equal(batch.heights[index], Math.fround(expected));
        assert.equal(batch.waterDistances[index], Infinity);
        assert.equal(world.isWater(x, z), false, 'new maps do not inherit the valley river or lakes');
      });
      runtime.memory.grow(1);
      assert.deepEqual(world.sampleTerrain(packed), batch, 'multi-chunk terrain views survive shared-memory growth');
    } finally { world.dispose(); }
  });

  test(`${id} native descent stops on its own terrain without valley ground or water snapping`, () => {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, id);
    const simulation = createWorldFlightSimulation(runtime, world.handle);
    try {
      const state = createFlightState();
      state.position = { x: 0, y: world.groundHeight(0, 80) + 18, z: 80 };
      const bounds = { minX: -2400, maxX: 2400, minZ: -2400, maxZ: 2400, maxAltitude: 800 };
      for (let frame = 0; frame < 240; frame++) {
        simulation.step(state, { forward: 0, strafe: 0, climb: -1, yaw: 0 }, 1 / 60,
          'assisted', getDroneSpec('freestyle').flight, { strength: 'calm', direction: 0 }, frame / 60, bounds);
        assert.ok(state.position.y >= world.groundHeight(state.position.x, state.position.z), 'aircraft remains above terrain');
      }
      assert.ok(state.position.y < world.groundHeight(0, 80) + 3);
    } finally { simulation.dispose(); world.dispose(); }
  });

  test(`${id} native bombs strike the scene-authored support height`, () => {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, id);
    const weapons = createWeaponSimulation(runtime, world, []);
    try {
      const x = 0, z = 80, support = world.surfaceHeight(x, z);
      assert.equal(weapons.drop({ x, y: support + 15, z }, { x: 0, y: 0, z: 0 }), true);
      let explosion;
      for (let frame = 0; frame < 120; frame++) {
        const result = weapons.step(1 / 60);
        if (result.impacts) { explosion = result.state.explosions[0]; break; }
      }
      assert.ok(explosion, 'falling bomb impacts within two seconds');
      near(explosion.position.y, support, 'explosion support');
    } finally { weapons.dispose(); world.dispose(); }
  });
}

test('downtown streets stay open while building walls and roof support share the uploaded geometry', () => {
  const world = createWorldKernel(createRustRuntime(module), 'downtown');
  try {
    const layout = getExplorationLayout('downtown');
    assert.ok(layout.buildings.length >= 190, 'central city has a real skyline beyond a few sample buildings');
    for (const building of layout.buildings) {
      const roof = buildingRoofDetails(building).cap;
      const top = roof.base + roof.height;
      const x = roof.x - roof.width * 0.27, z = roof.z + roof.depth * 0.27;
      near(world.surfaceHeight(x, z), top, 'building roof cap');
      near(world.flightSurfaceHeight(x, z, top + 1), top, 'descending to roof cap');
      const lowerCaps = getDowntownBuildingParts(building).caps.filter(part => Math.abs(x - part.x) <= part.width / 2
        && Math.abs(z - part.z) <= part.depth / 2 && part.base + part.height <= top - 0.95);
      const lowerSupport = Math.max(2, ...lowerCaps.map(part => part.base + part.height));
      near(world.flightSurfaceHeight(x, z, top - 1), lowerSupport, 'descending below the top roof can use the authored podium or terrace');
      assert.equal(world.intersectsObstacle({ x, y: building.base + 1, z }), true);
      assert.equal(world.intersectsObstacle({ x, y: top + 1, z }), false);
      assert.equal(world.clearance(building.x, building.z), false);
    }
    for (const street of DOWNTOWN_STREETS) for (let along = -2300; along <= 2300; along += 37) {
      for (const point of [{ x: street, z: along }, { x: along, z: street }]) {
        assert.equal(world.clearance(point.x, point.z, 12), true, 'continuous street corridor is free of buildings');
        near(world.surfaceHeight(point.x, point.z), 2, 'street support');
      }
    }
    assert.ok(layout.buildings.some(item => item.height > 150), 'city includes high-rise buildings');
  } finally { world.dispose(); }
});

test('downtown native support distinguishes roof caps, HVAC units and narrow rooftop antennas', () => {
  const world = createWorldKernel(createRustRuntime(module), 'downtown');
  try {
    const layout = getExplorationLayout('downtown');
    assert.equal(layout.buildings.length, 198, 'roof details are solids, not additional buildings');
    const building = layout.buildings.find(item => item.height > 150)!;
    const { cap, hvac, antenna } = buildingRoofDetails(building);
    assert.ok(antenna);
    const clearRoof = { x: cap.x - cap.width * 0.27, z: cap.z + cap.depth * 0.27 };
    near(world.surfaceHeight(clearRoof.x, clearRoof.z), cap.base + cap.height, 'roof cap top');
    near(world.flightSurfaceHeight(clearRoof.x, clearRoof.z, cap.base + 0.2), cap.base, 'below cap stays on the upper body support');
    near(world.surfaceHeight(hvac.x, hvac.z), hvac.base + hvac.height, 'HVAC top');
    assert.equal(world.intersectsObstacle({ x: hvac.x, y: hvac.base + hvac.height / 2, z: hvac.z }), true, 'HVAC has a solid side');
    assert.equal(world.intersectsObstacle({ x: hvac.x + hvac.width / 2 + 1, y: hvac.base + hvac.height / 2, z: hvac.z }), false, 'clear air beside HVAC stays open');
    near(world.surfaceHeight(antenna.x, antenna.z), antenna.base + antenna.height, 'antenna top');
    near(world.flightSurfaceHeight(antenna.x, antenna.z, antenna.base + antenna.height - 1), cap.base + cap.height, 'being below the antenna top does not snap to it');
    assert.equal(world.intersectsObstacle({ x: antenna.x, y: antenna.base + 5, z: antenna.z }), true, 'antenna mast collides');
    assert.equal(world.intersectsObstacle({ x: antenna.x + 0.8, y: antenna.base + 5, z: antenna.z }), false, 'air beside the narrow mast is clear');
  } finally { world.dispose(); }
});

test('setback terraces and courtyard voids have no obsolete full-envelope collider', () => {
  const world = createWorldKernel(createRustRuntime(module), 'downtown');
  try {
    for (const archetype of ['setback-tower', 'courtyard'] as const) {
      const building = getExplorationLayout('downtown').buildings.find(item => getDowntownBuildingParts(item).archetype === archetype)!;
      assert.ok(building);
      const parts = getDowntownBuildingParts(building);
      const x = building.x + building.width * (archetype === 'courtyard' ? 0.2 : 0.47);
      const z = building.z + building.depth * (archetype === 'courtyard' ? -0.2 : 0.47);
      const y = building.base + building.height * 0.6;
      const podium = parts.caps[0];
      assert.equal(world.intersectsObstacle({ x, y, z }), false, `${archetype} has open air above its lower podium`);
      near(world.surfaceHeight(x, z), podium.base + podium.height, `${archetype} lands on the real lower terrace`);
      assert.ok(world.surfaceHeight(x, z) < building.base + building.height * 0.5, 'old envelope roof no longer seals the void');
    }
  } finally { world.dispose(); }
});

test('downtown bombs land on high roofs instead of continuing to the street below', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'downtown');
  const weapons = createWeaponSimulation(runtime, world, []);
  try {
    const building = getExplorationLayout('downtown').buildings.find(item => item.height > 150)!;
    const cap = buildingRoofDetails(building).cap;
    const x = cap.x - cap.width * 0.27, z = cap.z + cap.depth * 0.27;
    const support = world.surfaceHeight(x, z);
    assert.ok(weapons.drop({ x, y: support + 12, z }, { x: 0, y: 0, z: 0 }));
    let explosion;
    for (let frame = 0; frame < 180; frame++) {
      const result = weapons.step(1 / 60);
      if (result.impacts) { explosion = result.state.explosions[0]; break; }
    }
    assert.ok(explosion);
    near(explosion.position.y, support, 'roof explosion');
  } finally { weapons.dispose(); world.dispose(); }
});

test('natural landmarks are distinct, finite and well below the mountain altitude limit', () => {
  const desertHeights = samples.map(point => explorationGroundHeight('desert', point.x, point.z));
  const mountainHeights = samples.map(point => explorationGroundHeight('mountains', point.x, point.z));
  assert.ok(Math.max(...desertHeights) - Math.min(...desertHeights) > 140);
  assert.ok(Math.max(...mountainHeights) - Math.min(...mountainHeights) > 600);
  assert.ok(Math.max(...mountainHeights) < 780);
  let envelopeMaximum = -Infinity;
  for (let x = -2400; x <= 2400; x += 20) for (let z = -2400; z <= 2400; z += 20) {
    envelopeMaximum = Math.max(envelopeMaximum, explorationGroundHeight('mountains', x, z));
  }
  assert.ok(envelopeMaximum > 700 && envelopeMaximum < 780, 'sharper ridgelines remain below the 800 m ceiling');
  assert.ok([...desertHeights, ...mountainHeights].every(height => Number.isFinite(height) && height > -2));
});
