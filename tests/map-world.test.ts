import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { HARBOR_BREAKWATERS, HARBOR_PIERS, HARBOR_SHORE_X, getMapLayout } from '../src/game/map-layout.ts';
import type { UrbanBox } from '../src/game/map-layout.ts';
import { WATER_LEVEL, WORLD_BOUNDS } from '../src/game/landscape.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { createSceneSimulation } from '../src/game/scene-simulation.ts';
import { createFlightState } from '../src/game/flight.ts';
import { getDroneSpec } from '../src/game/drone-catalog.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
}
function footprint(box: UrbanBox, x: number, z: number): boolean {
  const yaw = box.yaw ?? 0, dx = x - box.x, dz = z - box.z;
  return Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) <= box.width / 2 + 1e-10
    && Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) <= box.depth / 2 + 1e-10;
}

test('factory terrain is flat and dry for scalar and multi-chunk native batches', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'factory');
  try {
    const points = new Float64Array(1301 * 2);
    for (let i = 0; i < 1301; i++) points.set([-2000 + i * 3, -2500 + (i * 37) % 3900], i * 2);
    const batch = world.sampleTerrain(points);
    for (let i = 0; i < 1301; i++) {
      assert.equal(world.groundHeight(points[i * 2], points[i * 2 + 1]), 2);
      assert.equal(world.waterDistance(points[i * 2], points[i * 2 + 1]), Infinity);
      assert.equal(world.isWater(points[i * 2], points[i * 2 + 1]), false);
      assert.equal(batch.heights[i], 2); assert.equal(batch.waterDistances[i], Infinity);
    }
  } finally { world.dispose(); }
});

test('expanded harbor coastline, all nine scene piers and both breakwaters use one exact Rust land-water union', () => {
  const world = createWorldKernel(createRustRuntime(module), 'harbor');
  try {
    assert.equal(HARBOR_PIERS.length, 9);
    assert.equal(HARBOR_BREAKWATERS.length, 2);
    for (const pier of [...HARBOR_PIERS, ...HARBOR_BREAKWATERS]) {
      near(pier.x - pier.width / 2, HARBOR_SHORE_X);
      const east = pier.x + pier.width / 2;
      for (const x of [HARBOR_SHORE_X, HARBOR_SHORE_X + 10, east]) {
        assert.equal(world.isWater(x, pier.z), false);
        near(world.groundHeight(x, pier.z), pier.base + pier.height);
      }
      near(world.waterDistance(HARBOR_SHORE_X + 10, pier.z), pier.depth / 2);
      near(world.waterDistance(HARBOR_SHORE_X, pier.z), pier.depth / 2);
      near(world.waterDistance(HARBOR_SHORE_X - 10, pier.z), Math.hypot(10, pier.depth / 2));
      near(world.waterDistance(east, pier.z), 0);
      assert.equal(world.isWater(east + 0.001, pier.z), true);
      near(world.waterDistance(east + 10, pier.z), -10);
      near(world.waterDistance(east + 10, pier.z + pier.depth / 2 + 10), -Math.hypot(10, 10));
      assert.equal(world.isWater(pier.x, pier.z - pier.depth / 2 - 0.001), true);
      assert.equal(world.isWater(pier.x, pier.z + pier.depth / 2 + 0.001), true);
    }
    near(world.groundHeight(130, 80), 2);
    near(world.groundHeight(1000, 80), -18);
    near(world.surfaceHeight(1000, 80), WATER_LEVEL);
    const points = new Float32Array([130, 80, 141, 80, 180, 80, 1000, 80,
      ...[...HARBOR_PIERS, ...HARBOR_BREAKWATERS].flatMap(p => [p.x, p.z])]);
    const batch = world.sampleTerrain(points);
    for (let i = 0; i < points.length / 2; i++) {
      assert.equal(batch.heights[i], Math.fround(world.groundHeight(points[i * 2], points[i * 2 + 1])));
      assert.equal(batch.waterDistances[i], Math.fround(world.waterDistance(points[i * 2], points[i * 2 + 1])));
    }
  } finally { world.dispose(); }
});

test('shared-memory harbor uploads are isolated per handle, survive memory growth and reject malformed replacements atomically', () => {
  const runtime = createRustRuntime(module);
  const first = createWorldKernel(runtime, 'harbor'), second = createWorldKernel(runtime, 'harbor');
  const land: UrbanBox = { x: 1020, z: 2050, width: 1160, depth: 100, base: -8, height: 13 };
  try {
    const secondDistance = second.waterDistance(1500, 2050);
    first.setHarborGeometry(440, [land]);
    near(first.waterDistance(450, 2050), 50);
    near(first.groundHeight(1500, 2050), 5);
    assert.equal(first.isWater(1500, 2050), false);
    assert.equal(second.isWater(1500, 2050), true);
    near(second.waterDistance(1500, 2050), secondDistance);
    runtime.memory.grow(1);
    near(first.waterDistance(1500, 2050), 50);
    for (const invalid of [
      { ...land, x: land.x + 1 }, { ...land, yaw: 0.1 }, { ...land, width: 0 },
      { ...land, height: Infinity }, { ...land, height: -1 }, { ...land, height: 9.9 },
    ]) {
      assert.throws(() => first.setHarborGeometry(440, [invalid]), /geometry/);
      near(first.groundHeight(1500, 2050), 5);
    }
    assert.throws(() => first.setHarborGeometry(440, [land, { ...land, z: land.z + 20 }]), /invalid/);
    near(first.waterDistance(1500, 2050), 50);
    const pointer = runtime.call('world_harbor_alloc', first.handle, 1);
    for (const packet of [
      [440, 0, 1600, 2000, 2100, 5], [NaN, 1, 1600, 2000, 2100, 5],
      [440, 1, 440, 2000, 2100, 5], [440, 1, 1600, 2100, 2000, 5],
      [440, 1, 1600, 2000, 2100, Infinity],
    ]) {
      runtime.view(pointer, packet.length).set(packet);
      assert.equal(runtime.call('world_configure_harbor', first.handle, 1), 0);
      near(first.groundHeight(1500, 2050), 5);
    }
    assert.equal(runtime.call('world_configure_harbor', first.handle, 2), 0, 'dimension mismatch is rejected');
    assert.equal(runtime.call('world_harbor_alloc', first.handle, 1025), 0, 'bounded allocation rejects excessive dimensions');
    near(first.groundHeight(1500, 2050), 5);
    first.dispose();
    assert.throws(() => first.setHarborGeometry(440, [land]), /disposed/);
    near(second.waterDistance(1500, 2050), secondDistance);
  } finally { first.dispose(); second.dispose(); }
});

test('rotated native boxes collide with true footprints while elevated openings stay flyable', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'factory');
  const box = { x: 63.8, z: -64, width: 20, depth: 2, base: 10, height: 4, yaw: Math.PI / 4 };
  const point = (x: number, z: number, y: number) => ({
    x: box.x + x * Math.cos(box.yaw) + z * Math.sin(box.yaw),
    z: box.z - x * Math.sin(box.yaw) + z * Math.cos(box.yaw), y,
  });
  try {
    world.setBoxes([box]);
    assert.equal(world.intersectsObstacle(point(9.5, 0.5, 12)), true);
    assert.equal(world.intersectsObstacle(point(0, 5, 12)), false, 'a bounding circle would incorrectly block this route');
    assert.equal(world.intersectsObstacle(point(10.5, 1.5, 12)), false, 'rounded corner clearance uses actual closest distance');
    assert.equal(world.intersectsObstacle(point(10.3, 1.3, 12)), true);
    assert.equal(world.intersectsObstacle(point(0, 0, 9)), false);
    near(world.flightSurfaceHeight(box.x, box.z, 9), 2);
    near(world.flightSurfaceHeight(box.x, box.z, 14), 14);
    const outside = point(0, 5, 12);
    near(world.surfaceHeight(outside.x, outside.z), 2);
    assert.equal(world.clearance(outside.x, outside.z, 3), true);
    assert.equal(world.clearance(outside.x, outside.z, 4), false);
    runtime.memory.grow(1);
    world.setBoxes([]);
    assert.equal(world.intersectsObstacle(point(0, 0, 12)), false);
    near(world.surfaceHeight(box.x, box.z), 2);
    world.dispose(); assert.throws(() => world.setBoxes([box]), /disposed/);
  } finally { world.dispose(); }
});

test('native stacked roofs select each lower reachable layer and reject invalid replacement geometry', () => {
  const world = createWorldKernel(createRustRuntime(module), 'factory');
  const boxes: UrbanBox[] = [
    { x: 0, z: 0, width: 20, depth: 12, base: 2, height: 6 },
    { x: 0, z: 0, width: 4, depth: 4, base: 8, height: 5 },
    { x: 0, z: 0, width: 10, depth: 2, base: 20, height: 2 },
  ];
  try {
    world.setBoxes(boxes);
    near(world.surfaceHeight(0, 0), 22);
    for (const [fromY, expected] of [[30, 22], [18, 13], [10, 8], [6, 2]]) near(world.flightSurfaceHeight(0, 0, fromY), expected);
    near(world.flightSurfaceHeight(7, 0, 30), 8);
    assert.equal(world.intersectsObstacle({ x: 0, z: 0, y: 17 }), false);
    for (const invalid of [{ ...boxes[0], width: 0 }, { ...boxes[0], yaw: NaN }, { ...boxes[0], height: -1 }]) {
      assert.throws(() => world.setBoxes([invalid]), /invalid/);
      near(world.surfaceHeight(0, 0), 22);
    }
  } finally { world.dispose(); }
});

test('factory and harbor automatically upload the exact rendered warehouse/cargo/ship box layout', () => {
  for (const mapId of ['factory', 'harbor'] as const) {
    const world = createWorldKernel(createRustRuntime(module), mapId), layout = getMapLayout(mapId);
    try {
      assert.ok(layout.boxes.length > 100);
      for (const box of layout.boxes) {
        const roofs = layout.boxes.filter(other => footprint(other, box.x, box.z));
        const highest = Math.max(world.isWater(box.x, box.z) ? WATER_LEVEL : 2, ...roofs.map(b => b.base + b.height));
        near(world.surfaceHeight(box.x, box.z), highest);
        near(world.flightSurfaceHeight(box.x, box.z), highest);
        assert.equal(world.intersectsObstacle({ x: box.x, z: box.z, y: box.base + box.height / 2 }), true);
      }
    } finally { world.dispose(); }
  }
});

test('shared native weapon world intercepts factory roofs, harbor decks, concrete piers and open water', () => {
  const warehouse = getMapLayout('factory').warehouses[0];
  const roof = getMapLayout('factory').boxes.find(box => box.x === warehouse.x && box.z === warehouse.z
    && box.base === warehouse.base + warehouse.height)!;
  const ship = getMapLayout('harbor').ship!;
  for (const [mapId, x, z, expected] of [
    ['factory', warehouse.x, warehouse.z, roof.base + roof.height],
    ['harbor', ship.x + ship.width / 2 - 3, ship.z, ship.deckY],
    ['harbor', HARBOR_PIERS[0].x + HARBOR_PIERS[0].width / 2 - 3, HARBOR_PIERS[0].z, 2],
    ['harbor', 1000, 80, WATER_LEVEL],
  ] as const) {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, mapId);
    const weapons = createWeaponSimulation(runtime, world);
    try {
      assert.equal(weapons.drop({ x, z, y: expected + 20 }, { x: 0, y: 0, z: 0 }), true);
      let impacts = 0;
      for (let frame = 0; frame < 600 && !impacts; frame++) impacts += weapons.step(1 / 60).impacts;
      assert.equal(impacts, 1, `${mapId} bomb impact`);
      near(weapons.state.explosions[0].position.y, expected);
    } finally { weapons.dispose(); world.dispose(); }
  }
});

test('production Rust flight can land on a factory roof using the same world as weapons and terrain', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'factory');
  const flight = createWorldFlightSimulation(runtime, world.handle), warehouse = getMapLayout('factory').warehouses[0];
  const roof = getMapLayout('factory').boxes.find(box => box.x === warehouse.x && box.z === warehouse.z
    && box.base === warehouse.base + warehouse.height)!;
  const state = createFlightState(), profile = getDroneSpec('freestyle').flight;
  state.position = { x: warehouse.x, z: warehouse.z, y: warehouse.base + warehouse.height + 7 };
  let clock = 0;
  try {
    for (let frame = 0; frame < 300; frame++) {
      const result = flight.step(state, { forward: 0, strafe: 0, climb: -1, yaw: 0 }, 1 / 60,
        'assisted', profile, { strength: 'calm', direction: 0 }, clock, WORLD_BOUNDS);
      clock = result.windClock; assert.equal(result.obstacleContact, false);
    }
    near(state.position.y, roof.base + roof.height + 1.8);
    assert.equal(state.collision, true);
  } finally { flight.dispose(); world.dispose(); }
});

test('urban native scene batches keep animated ripple data without inherited forests or river currents', () => {
  for (const mapId of ['factory', 'harbor'] as const) {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, mapId);
    const scene = createSceneSimulation(runtime, world, [{ x: 0, z: 55 }, { x: 0, z: -100 }], [], 0);
    try {
      assert.deepEqual(scene.placements, { trees: [], rocks: [], banks: [], shrubs: [] });
      const points = new Float32Array([130, 80, 180, 80, 1000, 80]);
      const { heights } = world.sampleTerrain(points), water = scene.waterData(points, heights);
      assert.ok(water.currents.every(value => value === 0));
      for (let i = 0; i < heights.length; i++) {
        assert.equal(water.depths[i], Math.fround(WATER_LEVEL - world.groundHeight(points[i * 2], points[i * 2 + 1])));
      }
      const ripples = scene.ripplePixels(16);
      assert.equal(ripples.length, 16 * 16 * 4);
      assert.ok(ripples.some(value => value !== 255 && value !== 127));
      scene.dispose(); assert.throws(() => scene.ripplePixels(16), /disposed/);
    } finally { scene.dispose(); world.dispose(); }
  }
});
