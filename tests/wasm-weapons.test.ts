import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { Vec3 } from '../src/game/flight.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import type { RustRuntime } from '../src/game/rust-runtime.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import type { WorldKernel } from '../src/game/world-kernel.ts';
import {
  BLAST_RADIUS, BOMB_CAPACITY, BOMB_GRAVITY, DROP_COOLDOWN, EXPLOSION_LIFETIME,
  MAX_ACTIVE_BOMBS, RELOAD_TIME, TARGETS, createWeaponState, dropBomb, stepWeapons,
} from '../src/game/weapons.ts';
import type { ImpactSurface, WeaponState } from '../src/game/weapons.ts';
import { BRIDGES } from '../src/game/rural-layout.ts';
import { LAKES, WATER_LEVEL, surfaceHeight } from '../src/game/landscape.ts';
import { flightSurfaceHeight } from '../src/game/surfaces.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const flat: ImpactSurface = () => 0;
const still: Vec3 = { x: 0, y: 0, z: 0 };

function close(actual: unknown, expected: unknown, label = 'state'): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (!Number.isFinite(expected)) assert.equal(actual, expected, label);
    else assert.ok(Math.abs(actual - expected) <= 1e-8 + Math.abs(expected) * 1e-10,
      `${label}: ${actual} differs from ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), label);
    assert.equal(actual.length, expected.length, label);
    expected.forEach((value, index) => close(actual[index], value, `${label}[${index}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', label);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label} keys`);
    Object.entries(expected).forEach(([key, value]) => close((actual as Record<string, unknown>)[key], value, `${label}.${key}`));
    return;
  }
  assert.equal(actual, expected, label);
}

function callbackRuntime(surface: ImpactSurface): RustRuntime {
  // Only artificial migration fixtures use the callback mode. Production tests
  // below instantiate createRustRuntime(), whose imports throw if invoked.
  const instance = new WebAssembly.Instance(module, { env: {
    surface_height: (x: number, z: number, fromY: number) => surface(x, z, fromY),
    obstacle_hit: () => 0,
  } });
  const memory = instance.exports.memory as WebAssembly.Memory;
  return { memory,
    call(name, ...args) {
      const fn = instance.exports[name];
      assert.equal(typeof fn, 'function', `missing ${name}`);
      return Number((fn as (...args: number[]) => number)(...args) ?? 0);
    },
    view(pointer, length) { return new Float64Array(memory.buffer, pointer, length); },
  };
}

function fixture(surface: ImpactSurface = flat) {
  const runtime = callbackRuntime(surface);
  const simulation = createWeaponSimulation(runtime, { handle: 0 } as WorldKernel);
  const expected = createWeaponState();
  close(simulation.state, expected);
  return { runtime, simulation, expected,
    drop(position: Vec3, velocity: Vec3 = still) {
      const result = dropBomb(expected, position, velocity);
      assert.equal(simulation.drop(position, velocity), result);
      close(simulation.state, expected);
      return result;
    },
    step(dt: number) {
      const result = stepWeapons(expected, dt, surface);
      const actual = simulation.step(dt);
      assert.deepEqual({ impacts: actual.impacts, hits: actual.hits }, result);
      close(actual.state, expected);
      return actual;
    },
  };
}

test('real WASM drop copies drone motion, consumes ammo, and enforces cooldown', () => {
  const f = fixture();
  try {
    const position = { x: 1, y: 12, z: 55 }, velocity = { x: 2, y: 1, z: -10 };
    assert.equal(f.drop(position, velocity), true);
    const snapshot = f.simulation.state;
    position.x = 500; velocity.x = 500;
    assert.equal(snapshot.bombs[0].position.x, 1); assert.equal(snapshot.bombs[0].velocity.x, 2);
    assert.equal(f.drop(position, velocity), false);
    f.step(DROP_COOLDOWN); assert.equal(f.drop(position, velocity), true);
    assert.equal(snapshot.bombs.length, 1, 'previous outputs never alias Rust memory or later snapshots');
  } finally { f.simulation.dispose(); }
});

test('real WASM projectile gravity agrees with reference at 30, 60 and 120 fps', () => {
  for (const fps of [30, 60, 120]) {
    const f = fixture();
    try {
      f.drop({ x: 0, y: 100, z: 0 }, { x: 6, y: 3, z: -12 });
      for (let frame = 0; frame < fps; frame++) f.step(1 / fps);
      assert.ok(Math.abs(f.simulation.state.bombs[0].position.y - (99.2 + 3 - BOMB_GRAVITY / 2)) < 1e-8);
    } finally { f.simulation.dispose(); }
  }
});

test('real WASM swept long-frame impacts score targets only once', () => {
  const f = fixture(() => 2), target = TARGETS[0];
  try {
    f.drop({ ...target.position, y: 12 });
    assert.equal(f.step(1.5).hits, 1);
    assert.equal(f.simulation.state.explosions[0].position.y, 2);
    f.drop({ ...target.position, y: 12 });
    assert.equal(f.step(1.5).hits, 0);
    assert.equal(f.simulation.state.score, 100);
    assert.deepEqual(f.simulation.state.hitTargetIds, [target.id]);
  } finally { f.simulation.dispose(); }
});

test('real WASM locates trajectory contact before a distant frame endpoint', () => {
  const f = fixture();
  try {
    f.drop({ x: -10, y: 9.8, z: 55 }, { x: 10, y: 0, z: 0 });
    assert.equal(f.step(2).hits, 1);
    assert.ok(Math.abs(f.simulation.state.explosions[0].position.x) < 1e-5);
    assert.ok(Math.abs(f.simulation.state.explosions[0].age - 1) < 1e-5);
  } finally { f.simulation.dispose(); }
});

test('real WASM intermediate samples detect a raised ridge', () => {
  const f = fixture(x => x >= 2 && x <= 3 ? 6 : 0);
  try {
    f.drop({ x: 0, y: 5, z: 500 }, { x: 60, y: 0, z: 0 });
    assert.equal(f.step(0.1).impacts, 1);
    const impact = f.simulation.state.explosions[0].position;
    assert.ok(impact.x >= 2 && impact.x <= 3); assert.equal(impact.y, 6);
  } finally { f.simulation.dispose(); }
});

test('real WASM blast radius retains its inclusive boundary', () => {
  for (const [offset, hits] of [[BLAST_RADIUS, 1], [BLAST_RADIUS + 0.01, 0]]) {
    const f = fixture();
    try {
      f.drop({ x: offset, y: 0.8, z: 55 });
      assert.equal(f.step(1 / 60).hits, hits);
      assert.equal(f.simulation.state.score, hits * 100);
    } finally { f.simulation.dispose(); }
  }
});

test('real WASM sixth drop triggers a complete timed reload', () => {
  const f = fixture();
  try {
    for (let index = 0; index < BOMB_CAPACITY; index++) {
      assert.equal(f.drop({ x: 500, y: 100, z: 500 }), true);
      if (index < BOMB_CAPACITY - 1) f.step(DROP_COOLDOWN);
    }
    assert.equal(f.simulation.state.ammo, 0); assert.equal(f.simulation.state.reloadRemaining, RELOAD_TIME);
    assert.equal(f.drop({ x: 0, y: 12, z: 55 }), false);
    f.step(RELOAD_TIME - 0.01); assert.equal(f.simulation.state.ammo, 0);
    f.step(0.02); assert.equal(f.simulation.state.ammo, BOMB_CAPACITY);
    assert.equal(f.drop({ x: 0, y: 12, z: 55 }), true);
  } finally { f.simulation.dispose(); }
});

test('real WASM frame timers do not leave cooldown or reload numeric residues', () => {
  const f = fixture();
  try {
    for (let index = 0; index < BOMB_CAPACITY; index++) {
      f.drop({ x: 500, y: 1000, z: 500 });
      if (index < BOMB_CAPACITY - 1) {
        for (let frame = 0; frame < 27; frame++) f.step(1 / 60);
        assert.equal(f.simulation.state.cooldown, 0);
      }
    }
    for (let frame = 0; frame < 180; frame++) f.step(1 / 60);
    assert.equal(f.simulation.state.reloadRemaining, 0); assert.equal(f.simulation.state.ammo, BOMB_CAPACITY);
  } finally { f.simulation.dispose(); }
});

test('real WASM scores all practice targets and expires their explosions', () => {
  const f = fixture();
  try {
    for (const target of TARGETS) {
      f.drop({ ...target.position, y: 0.8 }); assert.equal(f.step(DROP_COOLDOWN).hits, 1);
    }
    assert.equal(f.simulation.state.score, 500);
    assert.deepEqual(f.simulation.state.hitTargetIds, TARGETS.map(target => target.id));
    f.step(EXPLOSION_LIFETIME); assert.equal(f.simulation.state.explosions.length, 0);
  } finally { f.simulation.dispose(); }
});

test('real WASM keeps smoke lifetime without rescoring impacts', () => {
  const f = fixture();
  try {
    f.drop({ x: 0, y: 0.8, z: 55 }); f.step(1 / 60); f.step(2.5);
    assert.equal(f.simulation.state.explosions.length, 1); assert.equal(f.simulation.state.score, 100);
    assert.ok(f.simulation.state.explosions[0].age > 2.5);
    f.step(EXPLOSION_LIFETIME); assert.equal(f.simulation.state.explosions.length, 0);
  } finally { f.simulation.dispose(); }
});

test('real WASM selects decks from above and lower ground from beneath', () => {
  for (const [height, expected] of [[12, 5], [4, -2]]) {
    const f = fixture((_x, _z, fromY = Infinity) => fromY >= 5 ? 5 : -2);
    try {
      f.drop({ x: 500, y: height, z: 500 }); assert.equal(f.step(1.5).impacts, 1);
      assert.equal(f.simulation.state.explosions[0].position.y, expected);
    } finally { f.simulation.dispose(); }
  }
});

test('real WASM invalid dt or drops cannot mutate state; invalid heights match fallback', () => {
  let queries = 0;
  const f = fixture(() => { queries++; return NaN; });
  try {
    f.drop({ x: 0, y: 12, z: 55 }); const before = structuredClone(f.simulation.state);
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
      f.step(dt); assert.deepEqual(f.simulation.state, before);
    }
    assert.equal(queries, 0);
    f.simulation.reset(); Object.assign(f.expected, createWeaponState());
    assert.equal(f.drop({ x: NaN, y: 12, z: 55 }), false);
    assert.equal(f.drop({ x: 0, y: 12, z: 55 }, { x: 0, y: Infinity, z: 0 }), false);
    f.drop({ x: 0, y: 12, z: 55 }); assert.equal(f.step(60).hits, 1);
    assert.equal(f.simulation.state.explosions.length, 0);
  } finally { f.simulation.dispose(); }
});

test('real WASM active projectiles, monotonic ids, and reset match reference bounds', () => {
  const f = fixture();
  try {
    for (let index = 0; index < MAX_ACTIVE_BOMBS; index++) {
      assert.equal(f.drop({ x: 500, y: 100_000, z: 500 }), true);
      f.step(f.simulation.state.ammo === 0 ? RELOAD_TIME : DROP_COOLDOWN);
    }
    assert.equal(f.simulation.state.bombs.length, MAX_ACTIVE_BOMBS);
    assert.equal(f.drop({ x: 500, y: 100_000, z: 500 }), false);
    const ids = f.simulation.state.bombs.map(bomb => bomb.id);
    assert.equal(new Set(ids).size, ids.length);
    close(f.simulation.reset(), createWeaponState());
  } finally { f.simulation.dispose(); }
});

test('production WASM weapons query native terrain, lakes, bridge decks and undersides without JS callbacks', () => {
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime);
  const simulation = createWeaponSimulation(runtime, world);
  const bridge = BRIDGES[0], lake = LAKES[0];
  const scenarios = [
    { x: 0, z: 55, y: surfaceHeight(0, 55) + 12, expectedY: surfaceHeight(0, 55) },
    { x: lake.x, z: lake.z, y: WATER_LEVEL + 12, expectedY: WATER_LEVEL },
    { x: bridge.x, z: bridge.z, y: bridge.deckY + 12, expectedY: bridge.deckY },
    { x: bridge.x, z: bridge.z, y: bridge.deckY - 0.2, expectedY: surfaceHeight(bridge.x, bridge.z) },
  ];
  try {
    for (const scenario of scenarios) {
      simulation.reset(); const expected = createWeaponState();
      const position = { x: scenario.x, y: scenario.y, z: scenario.z };
      dropBomb(expected, position, still); assert.equal(simulation.drop(position, still), true);
      const events = stepWeapons(expected, 1.5, flightSurfaceHeight);
      const actual = simulation.step(1.5);
      assert.deepEqual({ impacts: actual.impacts, hits: actual.hits }, events);
      close(actual.state, expected); close(actual.state.explosions[0].position.y, scenario.expectedY);
    }
  } finally { simulation.dispose(); world.dispose(); }
});

test('shared WASM memory growth and independent weapon handles preserve snapshots and disposal', () => {
  const runtime = callbackRuntime(flat), fakeWorld = { handle: 0 } as WorldKernel;
  const survivor = createWeaponSimulation(runtime, fakeWorld);
  try {
    survivor.drop({ x: 500, y: 100, z: 500 }, still);
    const snapshot = survivor.state, before = structuredClone(snapshot);
    runtime.memory.grow(1);
    for (let cycle = 0; cycle < 24; cycle++) {
      const temporary = createWeaponSimulation(runtime, fakeWorld);
      temporary.drop({ x: 0, y: 0.8, z: 55 }, still); temporary.step(1 / 60);
      temporary.dispose(); temporary.dispose();
      assert.throws(() => temporary.step(1 / 60), /disposed/);
      assert.equal(survivor.state.bombs.length, 1); assert.equal(survivor.state.score, 0);
    }
    const state = survivor.step(0.1).state;
    close(state.bombs[0].position.y, 99.11);
    assert.deepEqual(snapshot, before, 'old snapshots are detached from shared WASM memory');
    // Editing a decoded snapshot cannot change authoritative Rust simulation.
    state.ammo = 0; state.bombs[0].position.x = -999;
    assert.equal(survivor.step(0.1).state.ammo, BOMB_CAPACITY - 1);
    assert.equal(survivor.state.bombs[0].position.x, 500);
  } finally { survivor.dispose(); survivor.dispose(); }
});

test('weapon surface callbacks cannot reenter or dispose an active Rust call', () => {
  let checks = 0;
  const runtime = callbackRuntime(() => {
    checks++;
    assert.throws(() => simulation.step(0.1), /cannot reenter/);
    assert.throws(() => simulation.dispose(), /cannot reenter/);
    return 0;
  });
  const simulation = createWeaponSimulation(runtime, { handle: 0 } as WorldKernel);
  try {
    simulation.drop({ x: 0, y: 12, z: 55 }, still);
    assert.equal(simulation.step(1.5).hits, 1); assert.ok(checks > 0);
    assert.equal(simulation.state.score, 100);
  } finally { simulation.dispose(); }
});
