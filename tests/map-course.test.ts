import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DRONES, getFlightConfig } from '../src/game/drone-catalog.ts';
import { createFlightState, crossesCheckpoint } from '../src/game/flight.ts';
import type { Vec3 } from '../src/game/flight.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { getMapSpec } from '../src/game/map-catalog.ts';
import { getMapLayout } from '../src/game/map-layout.ts';
import { courseControls } from './helpers/course-controller.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
function collisionBoxes(mapId: 'factory' | 'harbor', p: Vec3, padding = 2) {
  return getMapLayout(mapId).boxes.filter(box => {
    const yaw = box.yaw ?? 0, dx = p.x - box.x, dz = p.z - box.z;
    const x = dx * Math.cos(yaw) - dz * Math.sin(yaw), z = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.max(0, Math.abs(x) - box.width / 2) ** 2 + Math.max(0, Math.abs(z) - box.depth / 2) ** 2 < padding ** 2
      && p.y > box.base - 0.45 && p.y < box.base + box.height + 0.45;
  });
}

for (const mapId of ['factory', 'harbor'] as const) {
  test(`${mapId} spawn, checkpoint openings and practice targets remain reachable in the real native world`, () => {
    const map = getMapSpec(mapId), world = createWorldKernel(createRustRuntime(module), mapId);
    const inBounds = (position: Vec3) => assert.ok(position.x > map.bounds.minX && position.x < map.bounds.maxX
      && position.z > map.bounds.minZ && position.z < map.bounds.maxZ, JSON.stringify(position));
    try {
      inBounds(map.spawn);
      assert.equal(world.intersectsObstacle(map.spawn), false, 'spawn avoids authored solids');
      assert.ok(map.spawn.y > world.flightSurfaceHeight(map.spawn.x, map.spawn.z, map.spawn.y) + 1.8);
      assert.equal(map.checkpoints.length, 8);
      for (const [index, gate] of map.checkpoints.entries()) {
        inBounds(gate.position);
        assert.equal(world.intersectsObstacle(gate.position), false, `gate ${index + 1} center avoids solids`);
        for (let vertex = 0; vertex < 24; vertex++) {
          const angle = vertex / 24 * Math.PI * 2, horizontal = Math.cos(angle) * gate.radius;
          const rim = { x: gate.position.x + Math.cos(gate.yaw) * horizontal,
            z: gate.position.z - Math.sin(gate.yaw) * horizontal,
            y: gate.position.y + Math.sin(angle) * gate.radius };
          assert.equal(world.intersectsObstacle(rim), false, `gate ${index + 1} rim avoids solids: ${JSON.stringify(rim)}`);
        }
        assert.ok(gate.position.y - gate.radius > world.flightSurfaceHeight(gate.position.x, gate.position.z, gate.position.y),
          `gate ${index + 1} opening stays above the nearest supporting surface`);
      }
      assert.equal(map.targets.length, 5);
      for (const target of map.targets) {
        inBounds(target.position);
        assert.equal(world.isWater(target.position.x, target.position.z), false, `${target.id} has dry ground or pier`);
        const surface = world.flightSurfaceHeight(target.position.x, target.position.z);
        assert.equal(surface, 2, `${target.id} stays on the authored practice ground`);
        assert.equal(world.intersectsObstacle({ ...target.position, y: surface + 1 }), false, `${target.id} is exposed above its support`);
        for (let vertex = 0; vertex < 24; vertex++) {
          const angle = vertex / 24 * Math.PI * 2;
          const x = target.position.x + Math.cos(angle) * target.radius;
          const z = target.position.z + Math.sin(angle) * target.radius;
          assert.equal(world.flightSurfaceHeight(x, z), 2, `${target.id} full marker stays clear of overhead cargo/structures at ${x}/${z}`);
          assert.equal(world.intersectsObstacle({ x, z, y: 3 }), false, `${target.id} rim stays above clear ground`);
        }
      }
    } finally { world.dispose(); }
  });

  for (const spec of DRONES) for (const mode of ['assisted', 'sport'] as const) {
    test(`${mapId} ${spec.id}/${mode} completes all eight gates with normal controls and zero native contacts`, () => {
      const map = getMapSpec(mapId), runtime = createRustRuntime(module), world = createWorldKernel(runtime, mapId);
      const simulation = createWorldFlightSimulation(runtime, world.handle);
      const state = createFlightState(map.spawn, map.spawnYaw);
      let clock = 0, passed = 0, contacts = 0;
      let firstContact: unknown;
      try {
        for (let frame = 0; frame < 600 * 60 && passed < map.checkpoints.length; frame++) {
          const gate = map.checkpoints[passed], previous = { ...state.position };
          const input = courseControls(state, gate, getFlightConfig(spec.id, mode).speed);
          const result = simulation.step(state, input, 1 / 60, mode, spec.flight, { strength: 'calm', direction: 0 }, clock, map.bounds);
          clock = result.windClock;
          if (state.collision || result.boundaryContact || result.obstacleContact) {
            contacts++;
            firstContact ??= { gate: passed + 1, seconds: clock, previous, current: { ...state.position },
              velocity: { ...state.velocity }, input, ground: state.collision, boundary: result.boundaryContact, obstacle: result.obstacleContact,
              support: world.flightSurfaceHeight(state.position.x, state.position.z, previous.y),
              nearbyBoxes: collisionBoxes(mapId, { x: previous.x, z: previous.z, y: previous.y }) };
          }
          if (crossesCheckpoint(previous, state.position, gate)) passed++;
        }
        assert.equal(passed, 8, `completed ${passed}/8; at ${JSON.stringify(state.position)}; contact ${JSON.stringify(firstContact)}`);
        assert.equal(contacts, 0, JSON.stringify(firstContact));
      } finally { simulation.dispose(); world.dispose(); }
    });
  }
}
