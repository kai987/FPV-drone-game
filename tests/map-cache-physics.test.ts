import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getDroneSpec } from '../src/game/drone-catalog.ts';
import { createFlightState } from '../src/game/flight.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { MAPS, getMapSpec } from '../src/game/map-catalog.ts';
import type { MapId } from '../src/game/map-catalog.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import type { RustRuntime } from '../src/game/rust-runtime.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { DROP_COOLDOWN } from '../src/game/weapons.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const still = { x: 0, y: 0, z: 0 };
const profile = getDroneSpec('freestyle').flight;
const calm = { strength: 'calm', direction: 0 } as const;

function residentMap(runtime: RustRuntime, mapId: MapId) {
  const spec = getMapSpec(mapId), world = createWorldKernel(runtime, mapId);
  const flight = createWorldFlightSimulation(runtime, world.handle);
  const weapons = createWeaponSimulation(runtime, world, spec.targets);
  const state = createFlightState(spec.spawn, spec.spawnYaw);
  return {
    spec, world, flight, weapons, state, windClock: 0,
    dispose() { flight.dispose(); weapons.dispose(); world.dispose(); },
  };
}

test('three resident map simulations preserve inactive flight and weapon state during alternating updates and resets', () => {
  const runtime = createRustRuntime(module);
  const maps = MAPS.map(spec => residentMap(runtime, spec.id));
  try {
    for (const map of maps) {
      const target = map.spec.targets[0].position;
      const surface = map.world.flightSurfaceHeight(target.x, target.z);
      assert.equal(map.weapons.drop({ ...target, y: surface + 0.9 }, still), true);
    }
    const originalPackets = maps.map(map => structuredClone(map.weapons.state));
    // Preloading later maps can grow shared memory after earlier adapters have
    // captured packet pointers. All resident services must refresh their views.
    runtime.memory.grow(1);
    for (const active of maps) {
      const paused = maps.filter(map => map !== active).map(map => ({
        map, flight: structuredClone(map.state), weapons: structuredClone(map.weapons.state), windClock: map.windClock,
      }));
      const events = active.weapons.step(DROP_COOLDOWN);
      assert.equal(events.impacts, 1);
      assert.equal(events.hits, 1);
      assert.equal(events.state.score, 100);
      assert.deepEqual(events.state.hitTargetIds, [active.spec.targets[0].id]);
      for (let frame = 0; frame < 60; frame++) {
        const result = active.flight.step(active.state, { forward: 0.25, strafe: 0, climb: 0.3, yaw: 0 },
          1 / 60, 'assisted', profile, calm, active.windClock, active.spec.bounds);
        active.windClock = result.windClock;
        assert.equal(result.obstacleContact, false);
        assert.equal(result.boundaryContact, false);
      }
      assert.ok(active.state.position.y > active.spec.spawn.y);
      assert.ok(active.state.position.z < active.spec.spawn.z);
      for (const snapshot of paused) {
        assert.deepEqual(snapshot.map.state, snapshot.flight, 'an inactive map never integrates flight');
        assert.deepEqual(snapshot.map.weapons.state, snapshot.weapons, 'an inactive map never advances bombs or explosions');
        assert.equal(snapshot.map.windClock, snapshot.windClock);
      }
    }
    const scored = maps.map(map => structuredClone(map.weapons.state));
    for (const [index, map] of maps.entries()) {
      const reset = map.weapons.reset();
      assert.equal(reset.ammo, 6); assert.equal(reset.score, 0);
      assert.deepEqual(reset.bombs, []); assert.deepEqual(reset.explosions, []); assert.deepEqual(reset.hitTargetIds, []);
      for (let other = index + 1; other < maps.length; other++) assert.deepEqual(maps[other].weapons.state, scored[other]);
      assert.equal(originalPackets[index].ammo, 5);
      assert.equal(originalPackets[index].bombs.length, 1, 'cached decoded packets retain their original data after resets');
      assert.equal(originalPackets[index].score, 0);
    }
  } finally { maps.forEach(map => map.dispose()); }
});

test('releasing and replacing one resident map leaves other native worlds and services valid', () => {
  const runtime = createRustRuntime(module);
  const valley = residentMap(runtime, 'valley'), harbor = residentMap(runtime, 'harbor');
  const survivors = [valley, harbor];
  const expectedTerrain = survivors.map(map => map.world.groundHeight(180, 80));
  const originalFactory = residentMap(runtime, 'factory');
  originalFactory.dispose(); originalFactory.dispose();
  try {
    assert.throws(() => originalFactory.world.groundHeight(180, 80), /disposed/);
    assert.throws(() => originalFactory.weapons.reset(), /disposed/);
    assert.throws(() => originalFactory.flight.step(originalFactory.state, { forward: 0, strafe: 0, climb: 0, yaw: 0 },
      1 / 60, 'assisted', profile, calm, 0), /disposed/);
    for (let cycle = 0; cycle < 12; cycle++) {
      const replacement = residentMap(runtime, 'factory');
      try {
        assert.equal(replacement.world.groundHeight(180, 80), 2);
        assert.equal(replacement.world.isWater(180, 80), false);
        assert.equal(harbor.world.isWater(180, 80), true);
        const target = replacement.spec.targets[0].position;
        replacement.weapons.drop({ ...target, y: 2.9 }, still);
        assert.equal(replacement.weapons.step(DROP_COOLDOWN).state.score, 100);
      } finally { replacement.dispose(); }
      for (const [index, map] of survivors.entries()) {
        assert.equal(map.world.groundHeight(180, 80), expectedTerrain[index]);
        assert.equal(map.weapons.state.ammo, 6); assert.equal(map.weapons.state.score, 0);
        const result = map.flight.step(map.state, { forward: 0, strafe: 0, climb: 0.2, yaw: 0 },
          1 / 60, 'assisted', profile, calm, map.windClock, map.spec.bounds);
        map.windClock = result.windClock;
        assert.ok(Number.isFinite(map.state.position.y));
        assert.equal(result.obstacleContact, false);
      }
    }
    assert.throws(() => originalFactory.world.handle, /disposed/, 'an old wrapper cannot access a reused native slot');
  } finally { survivors.forEach(map => map.dispose()); }
});
