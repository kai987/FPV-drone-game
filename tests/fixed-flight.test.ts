import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getDroneSpec } from '../src/game/drone-catalog.ts';
import type { DroneId } from '../src/game/drone-catalog.ts';
import { createFlightState } from '../src/game/flight.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { getMapSpec } from '../src/game/map-catalog.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { FixedSimulationClock, SIMULATION_STEP_SECONDS } from '../src/game/simulation-clock.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { BOMB_GRAVITY, DROP_COOLDOWN } from '../src/game/weapons.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';

// The production services share the emitted Rust artifact and native world;
// their legacy JavaScript terrain/obstacle imports throw if called.
const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const windSettings = { strength: 'strong', direction: 315 } as const;
const controls = { forward: 0.72, strafe: 0.23, climb: 0.06, yaw: 0.12, lookPitch: 0.1 };
const initialPosition = { x: 120, y: 200, z: 80 };
const initialVelocity = { x: 6, y: 1, z: -12 };
const still = { x: 0, y: 0, z: 0 };

function near(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
}

function fixture(droneId: DroneId = 'freestyle', scheduledDrops = true) {
  const runtime = createRustRuntime(module);
  const world = createWorldKernel(runtime, 'factory');
  const flight = createWorldFlightSimulation(runtime, world.handle);
  const map = getMapSpec('factory');
  const weapons = createWeaponSimulation(runtime, world, map.targets);
  const profile = getDroneSpec(droneId).flight;
  const state = createFlightState({ ...initialPosition }, 0.2);
  state.velocity = { ...initialVelocity };
  const clock = new FixedSimulationClock();
  clock.reset(0);
  let windClock = 0, elapsed = 0, steps = 0, impacts = 0, hits = 0;
  let wind = flight.step(state, controls, 0, 'sport', profile, windSettings, windClock, map.bounds).wind;
  assert.equal(weapons.drop(state.position, state.velocity), true);
  assert.deepEqual(weapons.state.bombs[0].velocity, initialVelocity, 'a released bomb inherits aircraft motion');
  const target = map.targets[0].position;
  const targetGround = world.flightSurfaceHeight(target.x, target.z);
  return {
    clock,
    frame(nowMs: number) {
      return clock.tick(nowMs, dt => {
        assert.equal(dt, SIMULATION_STEP_SECONDS);
        // Scheduled at simulation times, independently of render frame rate.
        // One near-ground drop exercises impact/explosion age; a later moving
        // drop leaves an active cooldown and an additional airborne projectile.
        if (scheduledDrops && steps === 180) {
          assert.equal(weapons.drop({ ...target, y: targetGround + 0.9 }, still), true);
        }
        if (scheduledDrops && steps === 228) assert.equal(weapons.drop(state.position, state.velocity), true);
        const result = flight.step(state, controls, dt, 'sport', profile, windSettings, windClock, map.bounds);
        assert.equal(result.boundaryContact, false);
        assert.equal(result.obstacleContact, false);
        assert.equal(state.collision, false, 'high-altitude flight stays clear of roofs and terrain');
        windClock = result.windClock;
        wind = result.wind;
        const events = weapons.step(dt);
        impacts += events.impacts;
        hits += events.hits;
        elapsed += dt;
        steps++;
      });
    },
    snapshot() {
      return structuredClone({ state, windClock, wind, elapsed, steps, weapons: weapons.state, impacts, hits });
    },
    dispose() { flight.dispose(); weapons.dispose(); world.dispose(); },
  };
}

function run(seconds: number, fps: number, droneId: DroneId = 'freestyle') {
  const f = fixture(droneId);
  try {
    for (let frame = 1; frame <= seconds * fps; frame++) {
      const result = f.frame(frame * 1000 / fps);
      assert.equal(result.droppedSeconds, 0);
    }
    return f.snapshot();
  } finally { f.dispose(); }
}

for (const droneId of ['freestyle', 'falcon'] as const) {
  test(`${droneId} production WASM flight, dynamic wind, projectiles, explosion ages and timer match at 10–120 FPS`, () => {
    const expected = run(4, 60, droneId);
    assert.equal(expected.steps, 240);
    near(expected.elapsed, 4, 'game timer');
    near(expected.windClock, 4, 'dynamic weather clock');
    assert.ok(Math.abs(expected.wind.fromDegrees - windSettings.direction) > 0.1, 'actual wind bearing changes during flight');
    assert.ok(Math.hypot(expected.state.velocity.x, expected.state.velocity.z) > 10, 'real Rust flight has accelerated');
    assert.equal(expected.weapons.bombs.length, 2, 'both high-altitude projectiles remain in flight');
    const originalBomb = expected.weapons.bombs.find(bomb => bomb.id === 1)!;
    near(originalBomb.position.x, initialPosition.x + initialVelocity.x * 4, 'initial bomb horizontal flight');
    near(originalBomb.position.y, initialPosition.y - 0.8 + initialVelocity.y * 4 - BOMB_GRAVITY * 4 ** 2 / 2,
      'initial bomb gravity integration');
    near(originalBomb.velocity.y, initialVelocity.y - BOMB_GRAVITY * 4, 'initial bomb vertical velocity');
    near(expected.weapons.cooldown, DROP_COOLDOWN - 0.2, 'late drop cooldown uses simulation time');
    assert.equal(expected.impacts, 1);
    assert.equal(expected.hits, 1);
    assert.equal(expected.weapons.score, 100);
    assert.equal(expected.weapons.explosions.length, 1);
    assert.ok(expected.weapons.explosions[0].age > 0.8 && expected.weapons.explosions[0].age < 1,
      'near-ground explosion has a real, still-active age');
    for (const fps of [10, 20, 30, 60, 120]) {
      assert.deepEqual(run(4, fps, droneId), expected,
        `${fps} FPS must produce identical native state, weather telemetry, projectile ages and timer`);
    }
  });
}

test('a one-minute pause and clock reset preserve native state and resume without background catch-up', () => {
  const paused = fixture(), uninterrupted = fixture();
  try {
    for (let frame = 1; frame <= 60; frame++) paused.frame(frame * 1000 / 60);
    const beforePause = paused.snapshot();
    paused.clock.reset(1_000);
    paused.clock.reset(61_000);
    assert.equal(paused.frame(61_000).steps, 0);
    assert.deepEqual(paused.snapshot(), beforePause, 'wind, aircraft, bombs and cooldown all freeze while paused');
    for (let frame = 1; frame <= 30; frame++) {
      assert.equal(paused.frame(61_000 + frame * 1000 / 30).droppedSeconds, 0);
    }
    for (let frame = 1; frame <= 120; frame++) uninterrupted.frame(frame * 1000 / 60);
    assert.deepEqual(paused.snapshot(), uninterrupted.snapshot(), 'only two active seconds reach Rust and the timer');
    near(paused.snapshot().elapsed, 2, 'resumed game timer');
    paused.clock.reset();
    assert.equal(paused.frame(120_000).steps, 0);
    assert.deepEqual(paused.snapshot(), uninterrupted.snapshot(), 'reset without a timestamp also skips the first resumed frame');
  } finally { paused.dispose(); uninterrupted.dispose(); }
});

test('a ten-second stall shares the same 0.25-second budget across all native systems and the timer', () => {
  const stalled = fixture('freestyle', false), reference = fixture('freestyle', false);
  try {
    const result = stalled.frame(10_000);
    assert.equal(result.steps, 15);
    near(result.advancedSeconds, 0.25, 'catch-up budget');
    near(result.droppedSeconds, 9.75, 'uniformly discarded stall time');
    for (let frame = 1; frame <= 15; frame++) reference.frame(frame * 1000 / 60);
    assert.deepEqual(stalled.snapshot(), reference.snapshot(), 'no native system advances beyond the shared budget');
    const state = stalled.snapshot();
    near(state.elapsed, 0.25, 'game timer budget');
    near(state.windClock, 0.25, 'wind budget');
    near(state.weapons.cooldown, DROP_COOLDOWN - 0.25, 'weapon timer budget');
    near(state.weapons.bombs[0].position.y,
      initialPosition.y - 0.8 + initialVelocity.y * 0.25 - BOMB_GRAVITY * 0.25 ** 2 / 2,
      'projectile integration budget');
    assert.equal(stalled.frame(10_000 + 1000 / 60).steps, 1);
    reference.frame(250 + 1000 / 60);
    assert.deepEqual(stalled.snapshot(), reference.snapshot(), 'discarded wall time never reappears in later native ticks');
  } finally { stalled.dispose(); reference.dispose(); }
});
