import assert from 'node:assert/strict';
import test from 'node:test';
import { interpolateBombPosition } from '../src/game/weapon-presentation.ts';
import type { Bomb } from '../src/game/weapons.ts';
import { createWeaponState } from '../src/game/weapons.ts';
import { createWeaponVisuals } from '../src/game/weapon-visuals.ts';

function bomb(id: number, x: number, y = 40, z = -100): Bomb {
  return { id, position: { x, y, z }, velocity: { x: 100, y: -6, z: 30 } };
}

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test('a projectile uses the same interpolation endpoints and fraction as the aircraft without mutating physics', () => {
  const previous = bomb(7, 10, 42, -104), current = bomb(7, 12, 40, -100);
  const physical = structuredClone({ previous, current });
  const target = { x: 0, y: 0, z: 0 };
  for (const [alpha, expected] of [
    [0, { x: 10, y: 42, z: -104 }],
    [0.5, { x: 11, y: 41, z: -102 }],
    [1, { x: 12, y: 40, z: -100 }],
  ] as const) {
    interpolateBombPosition(current, previous, alpha, target);
    assert.deepEqual(target, expected);
  }
  assert.deepEqual({ previous, current }, physical);
});

test('a fresh FALCON projectile shares at most one fixed step of aircraft presentation delay', () => {
  const current = bomb(8, 200);
  const physical = structuredClone(current), target = { x: 0, y: 0, z: 0 };
  interpolateBombPosition(current, undefined, 0, target);
  near(target.x, 200 - 100 / 60);
  near(target.y, 40 + 6 / 60);
  near(target.z, -100 - 30 / 60);
  interpolateBombPosition(current, undefined, 0.5, target);
  near(target.x, 200 - 100 / 120);
  interpolateBombPosition(current, undefined, 1, target);
  assert.deepEqual(target, current.position);
  assert.deepEqual(current, physical);
});

test('unrelated IDs cannot blend together and invalid alpha cannot extrapolate beyond one fixed step', () => {
  const current = bomb(8, 200), unrelated = bomb(7, -900), target = { x: 0, y: 0, z: 0 };
  interpolateBombPosition(current, unrelated, -2, target);
  near(target.x, 200 - 100 / 60);
  for (const alpha of [2, Infinity, -Infinity, Number.NaN]) {
    interpolateBombPosition(current, unrelated, alpha, target);
    assert.deepEqual(target, current.position);
  }
  interpolateBombPosition(current, current, 0, target);
  assert.deepEqual(target, current.position, 'reset or paused snapshots with identical endpoints do not move');
});

test('visuals match reordered projectiles by ID and remove impacted or reset projectiles immediately', () => {
  const visuals = createWeaponVisuals(undefined, undefined, []);
  const previous = createWeaponState(), current = createWeaponState();
  previous.bombs = [bomb(2, 40), bomb(1, 10)];
  current.bombs = [bomb(1, 12), bomb(2, 44)];
  const physical = structuredClone({ previous, current });
  const visibleBombs = () => visuals.group.children.filter(child => child.name === 'Metallic game canister' && child.visible);
  try {
    visuals.update(current, 1, previous, 0.5);
    assert.deepEqual(visibleBombs().map(visual => visual.position.x).sort((a, b) => a - b), [11, 42]);
    const impacted = { ...current, bombs: [current.bombs[1]] };
    visuals.update(impacted, 1.02, current, 0);
    assert.equal(visibleBombs().length, 1, 'an impacted projectile is not resurrected from the previous snapshot');
    assert.equal(visibleBombs()[0].position.x, 44);
    const reset = createWeaponState();
    visuals.update(reset, 0, impacted, 0.5);
    assert.equal(visibleBombs().length, 0);
    const freshRun = createWeaponState();
    freshRun.bombs = [bomb(1, 500)];
    visuals.update(freshRun, 0, reset, 0);
    near(visibleBombs()[0].position.x, 500 - 100 / 60);
    visuals.update(freshRun, 0);
    near(visibleBombs()[0].position.x, 500);
    assert.deepEqual({ previous, current }, physical);
  } finally { visuals.dispose(); }
});
