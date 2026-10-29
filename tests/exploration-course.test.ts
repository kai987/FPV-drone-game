import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DRONES, getFlightConfig } from '../src/game/drone-catalog.ts';
import { createFlightState, crossesCheckpoint } from '../src/game/flight.ts';
import { getMapSpec, MAPS } from '../src/game/map-catalog.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { bestTimeKey, readBestTime } from '../src/game/records.ts';
import { courseControls } from './helpers/course-controller.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const calm = { strength: 'calm', direction: 0 } as const;

test('all six maps keep independent records without importing valley legacy times', () => {
  const keys = MAPS.map(map => bestTimeKey('freestyle', 'assisted', calm, map.id));
  assert.equal(new Set(keys).size, 6);
  const values = Object.fromEntries(keys.map((key, index) => [key, String(30 + index)]));
  const storage = { getItem: (key: string) => values[key] ?? null };
  for (const [index, map] of MAPS.entries()) assert.equal(readBestTime(storage, 'freestyle', 'assisted', calm, map.id), 30 + index);
});

for (const mapId of ['desert', 'downtown', 'mountains'] as const) {
  test(`${mapId} launch, ring openings and target surfaces are dry and physically accessible`, () => {
    const map = getMapSpec(mapId), world = createWorldKernel(createRustRuntime(module), mapId);
    try {
      assert.ok(map.spawn.y > world.flightSurfaceHeight(map.spawn.x, map.spawn.z, map.spawn.y) + 10);
      assert.equal(world.intersectsObstacle(map.spawn), false);
      for (const [index, gate] of map.checkpoints.entries()) {
        for (let angleIndex = 0; angleIndex < 32; angleIndex++) {
          const angle = angleIndex / 32 * Math.PI * 2, horizontal = Math.cos(angle) * gate.radius;
          const rim = { x: gate.position.x + horizontal * Math.cos(gate.yaw),
            y: gate.position.y + Math.sin(angle) * gate.radius,
            z: gate.position.z - horizontal * Math.sin(gate.yaw) };
          assert.equal(world.intersectsObstacle(rim), false, `gate ${index + 1} is not inside a building or rock`);
          assert.ok(rim.y > world.groundHeight(rim.x, rim.z) + 1, `gate ${index + 1} clears the sloping terrain`);
        }
      }
      for (const target of map.targets) {
        const height = world.flightSurfaceHeight(target.position.x, target.position.z);
        assert.equal(world.isWater(target.position.x, target.position.z), false);
        assert.equal(world.intersectsObstacle({ ...target.position, y: height + 1 }), false);
      }
    } finally { world.dispose(); }
  });

  for (const drone of DRONES) for (const mode of ['assisted', 'sport'] as const) {
    test(`${mapId} ${drone.id}/${mode} completes eight rings using ordinary flight controls`, () => {
      const map = getMapSpec(mapId), runtime = createRustRuntime(module);
      const world = createWorldKernel(runtime, mapId), flight = createWorldFlightSimulation(runtime, world.handle);
      const state = createFlightState(map.spawn, map.spawnYaw);
      let passed = 0, clock = 0, firstContact: unknown;
      try {
        for (let frame = 0; frame < 600 * 60 && passed < map.checkpoints.length; frame++) {
          const gate = map.checkpoints[passed], previous = { ...state.position };
          const result = flight.step(state, courseControls(state, gate, getFlightConfig(drone.id, mode).speed),
            1 / 60, mode, drone.flight, calm, clock, map.bounds);
          clock = result.windClock;
          if (state.collision || result.boundaryContact || result.obstacleContact) firstContact ??= {
            passed, previous, position: { ...state.position }, ground: state.collision, boundary: result.boundaryContact, solid: result.obstacleContact,
          };
          if (crossesCheckpoint(previous, state.position, gate)) passed++;
        }
        assert.equal(passed, 8, `passed ${passed}/8; first contact ${JSON.stringify(firstContact)}`);
        assert.equal(firstContact, undefined, JSON.stringify(firstContact));
      } finally { flight.dispose(); world.dispose(); }
    });
  }
}
