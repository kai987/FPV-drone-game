import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { groundHeight, waterDistance, isWater, surfaceHeight, RIVER_SAMPLES, LAKES, lakeBoundary, WORLD_BOUNDS } from '../src/game/landscape.ts';
import { BRIDGES, CABINS, PASTURES, bridgePoint, bridgeDeckY, clearance } from '../src/game/rural-layout.ts';
import { flightSurfaceHeight } from '../src/game/surfaces.ts';
import { intersectsObstacle } from '../src/game/collisions.ts';
import type { WorldObstacle } from '../src/game/world.ts';
import { createFlightState } from '../src/game/flight.ts';
import { getDroneSpec, resolveFlightConfig } from '../src/game/drone-catalog.ts';
import { near, assertStateClose, stepReference } from './helpers/flight-reference.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const points = Array.from({ length: 1301 }, (_, index) => ({
  x: -2050 + ((index * 1547) % 4201), z: -2800 + ((index * 2347) % 4201),
}));

test('native Rust ground, signed river/lake union and water support match the scene reference', () => {
  const world = createWorldKernel(createRustRuntime(module));
  try {
    const samples = [...points, ...RIVER_SAMPLES, ...LAKES.map(lake => ({ x: lake.x, z: lake.z }))];
    for (const { x, z } of samples) {
      near(world.groundHeight(x, z), groundHeight(x, z), `ground ${x}/${z}`, 1e-8);
      near(world.waterDistance(x, z), waterDistance(x, z), `water ${x}/${z}`, 1e-8);
      assert.equal(world.isWater(x, z), isWater(x, z));
      near(world.surfaceHeight(x, z), surfaceHeight(x, z), `surface ${x}/${z}`, 1e-8);
    }
    for (const lake of LAKES) for (const p of lakeBoundary(lake, 96)) {
      // A lake boundary can lie inside the connected river channel. Compare
      // the signed union; the isolated native lake test checks zero contours.
      near(world.waterDistance(p.x, p.z), waterDistance(p.x, p.z), 'irregular lake/river contour union', 1e-8);
      assert.ok(world.waterDistance(p.x, p.z) <= 1e-8);
      for (const scale of [0.99999, 1.00001]) {
        const x = lake.x + (p.x - lake.x) * scale, z = lake.z + (p.z - lake.z) * scale;
        assert.equal(world.isWater(x, z), isWater(x, z));
      }
    }
  } finally { world.dispose(); }
});

test('native rural support preserves roof slopes, bridge ramps and flying beneath the bridge', () => {
  const world = createWorldKernel(createRustRuntime(module));
  try {
    const samples = CABINS.flatMap(c => Array.from({ length: 19 }, (_, i) => ({ x: c.x + (i - 9) * 0.65, z: c.z + Math.sin(i) * 3 })));
    for (const bridge of BRIDGES) for (const localX of [-bridge.length / 2, -bridge.span / 2 - 7, 0, bridge.span / 2 + 7, bridge.length / 2]) {
      const point = bridgePoint(bridge, localX);
      samples.push(point);
      near(world.flightSurfaceHeight(point.x, point.z, Infinity), flightSurfaceHeight(point.x, point.z), 'bridge/ramp support', 1e-8);
      const belowDeck = bridgeDeckY(bridge, localX) - 0.051;
      near(world.flightSurfaceHeight(point.x, point.z, belowDeck), surfaceHeight(point.x, point.z), 'under bridge', 1e-8);
    }
    for (const p of samples) for (const fromY of [-10, 0, 5, 12, Infinity]) {
      near(world.flightSurfaceHeight(p.x, p.z, fromY), flightSurfaceHeight(p.x, p.z, fromY), 'roof/deck origin support', 1e-8);
    }
    const clearings = [...points.slice(0, 200), ...CABINS, ...BRIDGES, ...PASTURES];
    for (const p of clearings) for (const padding of [0, 3, 9]) assert.equal(world.clearance(p.x, p.z, padding), clearance(p.x, p.z, padding));
  } finally { world.dispose(); }
});

test('static Rust obstacle grid matches detection around grid edges, roofs and elevated bridge beams', () => {
  const world = createWorldKernel(createRustRuntime(module));
  const bridge = BRIDGES[0], cabin = CABINS[0];
  const obstacles: WorldObstacle[] = [
    { x: 63.8, z: -64, radius: 2, height: 12 },
    { x: -64.2, z: 64, radius: 2.5, height: 10 },
    { x: cabin.x, z: cabin.z, radius: Math.hypot(cabin.width, cabin.depth) / 2 + 0.1, height: 20, roof: true },
    { x: bridge.x, z: bridge.z, radius: 2, base: bridge.deckY, height: bridge.deckY + 2 - groundHeight(bridge.x, bridge.z) },
  ];
  try {
    world.setObstacles(obstacles);
    for (const obstacle of obstacles) for (let xOffset = -4; xOffset <= 4; xOffset += 0.7) for (const zOffset of [-2.2, 0, 2.2]) for (const y of [-5, 0, 2, 5, 10, 20, 40]) {
      const position = { x: obstacle.x + xOffset, y, z: obstacle.z + zOffset };
      assert.equal(world.intersectsObstacle(position), obstacles.some(o => intersectsObstacle(position, o)), JSON.stringify(position));
    }
    world.setObstacles([]); assert.equal(world.intersectsObstacle({ x: 63.8, y: 5, z: -64 }), false);
  } finally { world.dispose(); }
});

test('terrain batches span multiple fixed chunks and survive shared memory growth', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime);
  try {
    const coordinates = new Float64Array(points.flatMap(p => [p.x, p.z]));
    const samples = world.sampleTerrain(coordinates);
    points.forEach((p, i) => { assert.equal(samples.heights[i], Math.fround(groundHeight(p.x, p.z))); assert.equal(samples.waterDistances[i], Math.fround(waterDistance(p.x, p.z))); });
    runtime.memory.grow(1);
    near(world.groundHeight(125, -310), groundHeight(125, -310), 'grown scalar world', 1e-8);
    const again = world.sampleTerrain(new Float32Array(coordinates));
    assert.deepEqual(again, samples);
    assert.throws(() => world.sampleTerrain(new Float32Array([1])), /packed/);
    world.dispose(); world.dispose();
    assert.throws(() => world.groundHeight(0, 0), /disposed/);
    assert.throws(() => world.handle, /disposed/);
  } finally { world.dispose(); }
});

test('production Rust flight uses native world surface and obstacle queries with no host imports', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime);
  const simulation = runtime.call('simulation_new');
  const inputPointer = runtime.call('simulation_input_ptr', simulation), outputPointer = runtime.call('simulation_output_ptr', simulation);
  const obstacle: WorldObstacle = { x: 0, z: 50, radius: 2, height: 50 };
  const profile = getDroneSpec('freestyle').flight, config = resolveFlightConfig(profile, 'assisted');
  const wind = { strength: 'strong', direction: 315 } as const;
  try {
    world.setObstacles([obstacle]);
    const actual = createFlightState(), expected = structuredClone(actual);
    let clock = 0, sawObstacle = false;
    for (let frame = 0; frame < 180; frame++) {
      const result = stepReference(expected, { forward: 1, strafe: 0, climb: 0, yaw: 0 }, 1 / 60, 'assisted', profile, wind, clock, flightSurfaceHeight, WORLD_BOUNDS, p => intersectsObstacle(p, obstacle));
      runtime.view(inputPointer, 36).set([
        actual.position.x, actual.position.y, actual.position.z, actual.velocity.x, actual.velocity.y, actual.velocity.z,
        actual.yaw, actual.pitch, actual.roll, actual.collision ? 1 : 0,
        1, 0, 0, 0, 0, 1 / 60, clock, 0,
        config.speed, config.climbSpeed, config.response, config.brake, config.yawSpeed, config.bank,
        10.5, 315, 1, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ, WORLD_BOUNDS.maxAltitude,
        0, 0, 0, 0,
      ]);
      assert.equal(runtime.call('simulate_world_tick', simulation, world.handle), 1);
      const output = runtime.view(outputPointer, 22);
      actual.position = { x: output[0], y: output[1], z: output[2] }; actual.velocity = { x: output[3], y: output[4], z: output[5] };
      actual.yaw = output[6]; actual.pitch = output[7]; actual.roll = output[8]; actual.collision = output[9] !== 0;
      clock = output[10]; sawObstacle ||= output[21] !== 0;
      assertStateClose(actual, expected, 'native world flight');
      near(clock, result.windClock, 'native clock');
      near(output[11], result.wind.vector.x, 'native final wind');
    }
    assert.equal(sawObstacle, true);
  } finally { runtime.call('simulation_free', simulation); world.dispose(); }
});
