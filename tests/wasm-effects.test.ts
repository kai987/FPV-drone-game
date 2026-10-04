import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import type { RustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createFish } from '../src/game/fish.ts';
import { createLivestock } from '../src/game/livestock.ts';
import { createExplosionSimulation, createFishSimulation, createLivestockSimulation } from '../src/game/effect-simulation.ts';
import { FISH_SCHOOLS } from '../src/game/rural-layout.ts';
import { LAKES, WATER_LEVEL, groundHeight } from '../src/game/landscape.ts';
import { BLAST_RADIUS, EXPLOSION_LIFETIME, MAX_ACTIVE_EXPLOSIONS } from '../src/game/weapons.ts';
import type { Explosion } from '../src/game/weapons.ts';
import { EFFECT_COLORS, explosionReference } from './helpers/explosion-reference.ts';

const wasmModule = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const colors = EFFECT_COLORS.flatMap(value => { const color = new THREE.Color(value); return [color.r, color.g, color.b]; });
const explosionConfig = { capacity: MAX_ACTIVE_EXPLOSIONS, lifetime: EXPLOSION_LIFETIME, blastRadius: BLAST_RADIUS, waterLevel: WATER_LEVEL, colors };
function nearArray(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 2e-8, label = '') {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < actual.length; i++) assert.ok(Number.isFinite(actual[i]) && Math.abs(actual[i] - expected[i]) <= tolerance,
    `${label}[${i}]: ${actual[i]} != ${expected[i]}`);
}
function meshes(group: THREE.Group) {
  const result: THREE.InstancedMesh[] = [];
  group.traverse(object => { if (object instanceof THREE.InstancedMesh) result.push(object); });
  return result;
}
function compareModels(actual: THREE.Group, expected: THREE.Group) {
  const a = meshes(actual); const b = meshes(expected);
  assert.equal(a.length, b.length);
  a.forEach((mesh, index) => {
    assert.equal(mesh.name, b[index].name); assert.equal(mesh.count, b[index].count);
    nearArray(mesh.instanceMatrix.array, b[index].instanceMatrix.array, 6e-5, mesh.name);
  });
}
function instrument(runtime: RustRuntime) {
  const calls = new Map<string, number>();
  return { calls, runtime: { memory: runtime.memory, view: runtime.view, call(name: string, ...args: number[]) {
    calls.set(name, (calls.get(name) ?? 0) + 1); return runtime.call(name, ...args);
  } } satisfies RustRuntime };
}

test('real WASM fish matrices match every original Three part through school wrapping and pauses', () => {
  const recorded = instrument(createRustRuntime(wasmModule));
  const native = createFish(recorded.runtime); const reference = createFish();
  try {
    assert.equal(recorded.calls.get('effects_initialize'), 1);
    let updates = recorded.calls.get('effects_update')!;
    for (const time of [0, 0, 1 / 120, 1 / 60, 0.7, 17.3, 99.99, 100, 125, 0, 5000]) {
      native.update(time); reference.update(time); compareModels(native.group, reference.group);
      assert.equal(recorded.calls.get('effects_update'), ++updates, 'one call covers all fish and fins');
    }
    assert.equal(recorded.calls.get('effects_config_ptr'), 1, 'static school paths uploaded once');
  } finally { native.dispose(); native.dispose(); reference.dispose(); }
  const count = recorded.calls.get('effects_update'); native.update(5);
  assert.equal(recorded.calls.get('effects_update'), count); assert.equal(recorded.calls.get('effects_free'), 1);
});

test('real WASM cattle and sheep match all original body, joint, hoof and fleece matrices', () => {
  const recorded = instrument(createRustRuntime(wasmModule)); const world = createWorldKernel(recorded.runtime);
  const native = createLivestock(recorded.runtime, world); const reference = createLivestock();
  try {
    compareModels(native.group, reference.group);
    const before = recorded.calls.get('effects_update')!;
    const frames = 360;
    for (let frame = 0; frame < frames; frame++) {
      // Cross feeding and walking phases and exercise the original .08 dt cap.
      const time = frame * 0.2;
      native.update(time); reference.update(time);
      if (frame % 9 === 0 || frame === frames - 1) compareModels(native.group, reference.group);
      if (frame === 150) { native.update(time); reference.update(time); compareModels(native.group, reference.group); }
    }
    assert.equal(recorded.calls.get('effects_update'), before + frames + 1);
    assert.equal(recorded.calls.get('world_query') ?? 0, 0, 'herd heights are queried natively, without per-animal JS calls');
    assert.equal(recorded.calls.get('effects_initialize'), 1);
    native.update(1); reference.update(1); compareModels(native.group, reference.group);
  } finally { native.dispose(); native.dispose(); reference.dispose(); world.dispose(); }
  assert.equal(recorded.calls.get('effects_free'), 1);
});

function compareExplosionFrame(native: ReturnType<typeof createExplosionSimulation>, state: Explosion[], time: number, night: boolean) {
  const result = native.update(state, time, night);
  const reference = explosionReference(state, time, night);
  const layout = native.layout;
  reference.fields.forEach((field, index) => {
    assert.equal(result[index], field.opacity.length, `field ${index} count`);
    const l = layout.fields[index];
    for (const [offset, values] of [[l.matrices, field.matrices], [l.colors, field.colors], [l.opacity, field.opacity], [l.seed, field.seeds]] as const) {
      nearArray(result.subarray(offset, offset + values.length), values, 4e-8, `field ${index} at ${time}`);
    }
  });
  assert.equal(result[6], reference.ring.opacity.length); assert.equal(result[7], reference.fragments.length / 16);
  assert.equal(result[8], reference.lights.length / 7);
  for (const [offset, values] of [[layout.rings.matrices, reference.ring.matrices], [layout.rings.colors, reference.ring.colors],
    [layout.rings.opacity, reference.ring.opacity], [layout.fragments, reference.fragments], [layout.lights, reference.lights]] as const) {
    nearArray(result.subarray(offset, offset + values.length), values, 4e-8, `effect at ${time}`);
  }
  assert.ok(result.every(Number.isFinite));
}

test('real WASM land/water smoke, flame, dust, spray, rings, debris and night flashes match original equations', () => {
  const runtime = createRustRuntime(wasmModule); const world = createWorldKernel(runtime);
  const native = createExplosionSimulation(runtime, explosionConfig, world);
  const land = { x: -107, y: groundHeight(-107, 21), z: 21 };
  const water = { x: LAKES[0].x, y: WATER_LEVEL, z: LAKES[0].z };
  try {
    for (const age of [-1, 0, 0.009, 0.025, 0.05, 0.11, 0.199, 0.2, 0.31, 0.649, 0.65, 0.7, 1.099, 1.15, 1.75, 2.5, 2.99, 3.4, EXPLOSION_LIFETIME, 10]) {
      for (const night of [false, true]) {
        const state = [
          { id: 1, position: land, age, hitCount: 0 }, { id: 92, position: water, age, hitCount: 0 },
          // A blast above water but above the surface threshold remains a land-type effect.
          { id: 518, position: { ...water, y: WATER_LEVEL + 0.36 }, age, hitCount: 0 },
        ];
        compareExplosionFrame(native, state, age, night);
        compareExplosionFrame(native, state, age, night); // paused update is stable
      }
    }
  } finally { native.dispose(); world.dispose(); }
});

test('real WASM explosion batches retain the newest 32 events, reset counts and clamp fixed flash lights', () => {
  const recorded = instrument(createRustRuntime(wasmModule)); const world = createWorldKernel(recorded.runtime);
  const native = createExplosionSimulation(recorded.runtime, explosionConfig, world);
  const state = Array.from({ length: 48 }, (_, i): Explosion => ({ id: i + 1000, position: { x: -107, y: 5, z: 21 }, age: 0.05, hitCount: 0 }));
  try {
    compareExplosionFrame(native, state, 0.05, true);
    const frame = native.update(state, 0.05, true);
    assert.equal(frame[1], 8 * MAX_ACTIVE_EXPLOSIONS); assert.equal(frame[5], MAX_ACTIVE_EXPLOSIONS);
    assert.equal(frame[6], MAX_ACTIVE_EXPLOSIONS); assert.equal(frame[7], 16 * MAX_ACTIVE_EXPLOSIONS); assert.equal(frame[8], 3);
    assert.equal(recorded.calls.get('world_query') ?? 0, 0, 'water tests remain inside the native batch');
    nearArray(native.update([], 3).subarray(0, 9), new Float64Array(9));
  } finally { native.dispose(); world.dispose(); }
});

test('effect buffers refresh after shared WASM memory grows and independent instances stay independent', () => {
  const runtime = createRustRuntime(wasmModule); const world = createWorldKernel(runtime);
  const fish = createFishSimulation(runtime, FISH_SCHOOLS, WATER_LEVEL);
  const explosions = createExplosionSimulation(runtime, explosionConfig, world);
  const a = createLivestockSimulation(runtime, [{ species: 'cow', field: { x: 0, z: 0 }, phase: 0, radius: 5, offset: 0, size: 1, activityOffset: 0 }],
    [{ parent: 0, local: new THREE.Matrix4().elements }], world);
  const b = createLivestockSimulation(runtime, [{ species: 'cow', field: { x: 0, z: 0 }, phase: 0, radius: 5, offset: 0, size: 1, activityOffset: 0 }],
    [{ parent: 0, local: new THREE.Matrix4().elements }], world);
  try {
    const saved = fish.update(4).slice(); runtime.memory.grow(2); nearArray(fish.update(4), saved, 0);
    for (let i = 0; i < 500; i++) a.update(i / 10);
    nearArray(b.update(0), b.update(0).slice(), 0);
    assert.ok(Math.abs(a.update(50)[12] - b.update(0)[12]) > 0.01, 'each herd owns its state');
    nearArray(explosions.update([], 0).subarray(0, 9), new Float64Array(9));
  } finally { fish.dispose(); explosions.dispose(); a.dispose(); b.dispose(); world.dispose(); }
  assert.throws(() => fish.update(1), /disposed/); assert.throws(() => explosions.update([], 1), /disposed/);
  assert.throws(() => a.update(1), /disposed/); fish.dispose(); explosions.dispose(); a.dispose();
});

test('real WASM effect services reject invalid input and repeatedly release their owned buffers', () => {
  const runtime = createRustRuntime(wasmModule);
  for (let i = 0; i < 30; i++) {
    const fish = createFishSimulation(runtime, FISH_SCHOOLS, WATER_LEVEL);
    const explosion = createExplosionSimulation(runtime, explosionConfig);
    assert.throws(() => fish.update(NaN), /Invalid Rust animation tick/);
    const frame = explosion.update([{ id: 1, position: { x: NaN, y: 0, z: 0 }, age: 0.1 }], 0.1);
    nearArray(frame.subarray(0, 9), new Float64Array(9));
    const water = explosion.update([{ id: 2, position: { x: 0, y: 0, z: 0 }, age: 0, waterImpact: true }], 0);
    assert.equal(water[4], 22); assert.equal(water[6], 3); assert.equal(water[7], 0);
    fish.dispose(); explosion.dispose();
  }
  assert.throws(() => createExplosionSimulation(runtime, { ...explosionConfig, colors: [] }), /Invalid Rust animation layout/);
});
