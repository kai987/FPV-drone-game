import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { Vec3 } from '../src/game/flight.ts';
import { createGunSimulation } from '../src/game/gun-simulation.ts';
import { createGunState, GUN_CAPACITY, GUN_MAX_IMPACTS, GUN_MAX_SHOTS, GUN_RANGE, GUN_SHOT_LIFETIME } from '../src/game/gun.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import type { RustRuntime } from '../src/game/rust-runtime.ts';
import type { Target } from '../src/game/weapons.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const origin: Vec3 = { x: 0, y: 1000, z: 0 };
const forward: Vec3 = { x: 0, y: 0, z: -1 };
const target: Target = { id: 'practice', position: { x: 0, y: 1000, z: -40 }, radius: 4 };
function fixture(targets: readonly Target[] = []) {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'factory');
  world.setBoxes([]);
  const gun = createGunSimulation(runtime, world, targets);
  return { runtime, world, gun, dispose() { gun.dispose(); world.dispose(); } };
}

test('native gun held fire produces 24 shots per second and a dense bounded trace trail at 30, 60 and 120 fps', () => {
  for (const fps of [30, 60, 120]) {
    const f = fixture();
    try {
      let fired = 0;
      for (let frame = 0; frame < fps; frame++) fired += f.gun.step(1 / fps, true, origin, forward).shots;
      assert.equal(fired, 24); assert.equal(f.gun.state.totalShots, 24); assert.equal(f.gun.state.ammo, 16);
      assert.ok(f.gun.state.shots.length >= 10 && f.gun.state.shots.length <= 11,
        `24 Hz firing should leave about 11 visible traces, got ${f.gun.state.shots.length}`);
      assert.ok(f.gun.state.shots.every(shot => shot.age < GUN_SHOT_LIFETIME));
      assert.equal(new Set(f.gun.state.shots.map(shot => shot.id)).size, f.gun.state.shots.length);
      f.gun.step(1, false, origin, forward);
      assert.equal(f.gun.state.totalShots, 24, 'release prevents all additional shots');
      assert.equal(f.gun.state.shots.length, 0); assert.equal(f.gun.state.impacts.length, 0);
      assert.equal(f.gun.step(1 / fps, true, origin, forward).shots, 1, 'fresh press fires immediately after cooldown');
    } finally { f.dispose(); }
  }
});

test('native gun reloads after the fortieth shot and resumes a held trigger', () => {
  const f = fixture();
  try {
    assert.equal(f.gun.step(2, true, origin, forward).shots, GUN_CAPACITY);
    assert.equal(f.gun.state.ammo, 0);
    assert.ok(Math.abs(f.gun.state.reloadRemaining - 2.025) < 1e-8);
    assert.equal(f.gun.step(2.02, true, origin, forward).shots, 0);
    assert.equal(f.gun.step(0.01, true, origin, forward).shots, 1);
    assert.equal(f.gun.state.ammo, 39); assert.equal(f.gun.state.reloadRemaining, 0);
    assert.equal(f.gun.state.totalShots, 41);
    assert.deepEqual(f.gun.reset(), createGunState());
  } finally { f.dispose(); }
});

test('practice targets score once and stop rays before a farther target', () => {
  const f = fixture([target, { ...target, id: 'behind', position: { ...target.position, z: -80 } }]);
  try {
    assert.equal(f.gun.step(1 / 60, true, origin, forward).hits, 1);
    assert.equal(f.gun.state.score, 100); assert.deepEqual(f.gun.state.hitTargetIds, ['practice']);
    assert.equal(f.gun.state.impacts[0].hit, true);
    assert.ok(Math.abs(f.gun.state.shots[0].to.z + 36) < 1e-8);
    f.gun.step(1, true, origin, forward);
    assert.equal(f.gun.state.score, 100); assert.equal(f.gun.state.hitTargetIds.length, 1);
    f.gun.reset();
    assert.equal(f.gun.step(1 / 60, true, { ...origin, y: origin.y + 2 }, forward).hits, 0,
      'a wide ground pad does not gain an unrealistically tall hit volume');
  } finally { f.dispose(); }
});

test('native gun stops at the first thin building wall and terrain before targets', () => {
  const f = fixture([target]);
  try {
    f.world.setBoxes([{ x: 0, z: -20, width: 8, depth: 0.1, base: 990, height: 20 }]);
    assert.equal(f.gun.step(1 / 60, true, origin, forward).hits, 0);
    assert.equal(f.gun.state.impacts[0].hit, false);
    assert.ok(f.gun.state.shots[0].to.z > -21 && f.gun.state.shots[0].to.z < -19);
    f.gun.reset(); f.world.setBoxes([]);
    const ground = f.world.flightSurfaceHeight(0, 0);
    f.gun.step(1 / 60, true, { x: 0, y: ground + 10, z: 0 }, { x: 0, y: -2, z: 0 });
    assert.ok(Math.abs(f.gun.state.impacts[0].position.y - ground) < 0.001);
  } finally { f.dispose(); }
});

test('camera crosshair convergence still respects an obstruction between muzzle and aim point', () => {
  const f = fixture([target]), muzzle = { ...origin, x: 5 }, camera = { ...origin, z: 10 };
  try {
    assert.equal(f.gun.step(1 / 60, true, muzzle, forward).hits, 0);
    f.gun.reset();
    assert.equal(f.gun.step(1 / 60, true, muzzle, forward, camera).hits, 1);
    assert.deepEqual(f.gun.state.shots[0].from, muzzle);
    f.gun.reset();
    f.world.setBoxes([{ x: 2.5, z: -18, width: 1, depth: 2, base: 990, height: 20 }]);
    assert.equal(f.gun.step(1 / 60, true, muzzle, forward, camera).hits, 0);
    assert.equal(f.gun.state.impacts[0].hit, false);
    assert.ok(f.gun.state.impacts[0].position.z > -20);
  } finally { f.dispose(); }
});

test('native gun normalizes aim, bounds visual records, and ages out effects on release', () => {
  const f = fixture([target]);
  try {
    for (let second = 0; second < 60; second++) {
      f.gun.step(1, true, origin, { x: 0, y: 0, z: -5 });
      assert.ok(f.gun.state.shots.length <= GUN_MAX_SHOTS);
      assert.ok(f.gun.state.impacts.length <= GUN_MAX_IMPACTS);
    }
    assert.equal(f.gun.state.score, 100);
    f.gun.step(GUN_SHOT_LIFETIME + 0.01, false, origin, forward);
    assert.deepEqual(f.gun.state.shots, []); assert.deepEqual(f.gun.state.impacts, []);
    f.gun.reset();
    f.gun.step(1 / 60, true, origin, { x: 7, y: 0, z: 0 });
    assert.ok(Math.abs(f.gun.state.shots[0].to.x - GUN_RANGE) < 1e-8);
    assert.equal(f.gun.state.impacts.length, 0, 'open sky does not create impact sparks');
  } finally { f.dispose(); }
});

test('invalid times, vectors, zero direction and aim origin cannot mutate native gun state', () => {
  const f = fixture();
  try {
    f.gun.step(1 / 60, true, origin, forward);
    const before = structuredClone(f.gun.state);
    for (const dt of [0, -1, NaN, Infinity, -Infinity, 11]) {
      assert.equal(f.gun.step(dt, true, origin, forward).shots, 0);
      assert.deepEqual(f.gun.state, before);
    }
    for (const [from, direction, aim] of [
      [{ ...origin, x: NaN }, forward, undefined],
      [origin, { ...forward, z: Infinity }, undefined],
      [origin, { x: 0, y: 0, z: 0 }, undefined],
      [origin, forward, { ...origin, y: NaN }],
    ] as [Vec3, Vec3, Vec3 | undefined][]) {
      f.gun.step(0.1, true, from, direction, aim); assert.deepEqual(f.gun.state, before);
    }
  } finally { f.dispose(); }
});

test('shared memory growth, independent handles, detached snapshots and disposal are safe', () => {
  const f = fixture(), second = createGunSimulation(f.runtime, f.world, []);
  try {
    f.gun.step(1 / 60, true, origin, forward);
    const snapshot = f.gun.state, before = structuredClone(snapshot);
    f.runtime.memory.grow(1);
    f.gun.step(0.2, true, origin, forward);
    assert.deepEqual(snapshot, before);
    assert.equal(second.state.ammo, GUN_CAPACITY);
    f.gun.state.ammo = 0; f.gun.state.shots[0].from.x = -999;
    f.gun.step(0.01, false, origin, forward);
    assert.equal(f.gun.state.ammo, 34); assert.equal(f.gun.state.shots[0].from.x, 0);
    f.world.dispose();
    assert.throws(() => f.gun.step(0.1, true, origin, forward), /disposed/);
    f.gun.dispose(); f.gun.dispose();
    assert.throws(() => f.gun.state, /disposed/); assert.throws(() => f.gun.reset(), /disposed/);
  } finally { second.dispose(); f.dispose(); }
});

test('invalid construction and decode failures free every allocated native gun', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'factory');
  let freed = 0;
  const tracked: RustRuntime = { ...runtime, call(name, ...args) {
    if (name === 'gun_free') freed++;
    return runtime.call(name, ...args);
  } };
  try {
    assert.throws(() => createGunSimulation(tracked, world, [{ ...target, radius: NaN }]), /configuration/);
    assert.equal(freed, 1);
    const failing: RustRuntime = { ...tracked, view(pointer, length) {
      if (length === 9 + GUN_MAX_SHOTS * 8 + GUN_MAX_IMPACTS * 6 + 16) throw new Error('decode failed');
      return tracked.view(pointer, length);
    } };
    assert.throws(() => createGunSimulation(failing, world, []), /decode failed/);
    assert.equal(freed, 2);
    assert.throws(() => createGunSimulation(tracked, world, [target, target]), /target list/);
    assert.equal(freed, 2, 'duplicate target IDs reject before allocation');
  } finally { world.dispose(); }
});
