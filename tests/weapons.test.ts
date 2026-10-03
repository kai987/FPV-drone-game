import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLAST_RADIUS, BOMB_CAPACITY, BOMB_GRAVITY, DROP_COOLDOWN, EXPLOSION_LIFETIME,
  MAX_ACTIVE_BOMBS, RELOAD_TIME, TARGETS, createWeaponState, dropBomb, stepWeapons,
} from '../src/game/weapons.ts';

const flatGround = () => 0;
const still = { x: 0, y: 0, z: 0 };

test('a drop consumes one round, copies drone motion, and enforces its cooldown', () => {
  const state = createWeaponState();
  const position = { x: 1, y: 12, z: 55 };
  const velocity = { x: 2, y: 1, z: -10 };
  assert.equal(dropBomb(state, position, velocity), true);
  assert.equal(state.ammo, BOMB_CAPACITY - 1);
  assert.deepEqual(state.bombs[0].position, { x: 1, y: 11.2, z: 55 });
  assert.deepEqual(state.bombs[0].velocity, velocity);
  position.x = 500;
  velocity.x = 500;
  assert.equal(state.bombs[0].position.x, 1);
  assert.equal(state.bombs[0].velocity.x, 2);
  assert.equal(dropBomb(state, position, velocity), false);
  stepWeapons(state, DROP_COOLDOWN, flatGround);
  assert.equal(dropBomb(state, position, velocity), true);
});

test('gravity and inherited horizontal velocity determine the flight path', () => {
  const state = createWeaponState();
  dropBomb(state, { x: 0, y: 100, z: 0 }, { x: 6, y: 3, z: -12 });
  stepWeapons(state, 1, flatGround);
  const bomb = state.bombs[0];
  assert.ok(Math.abs(bomb.position.x - 6) < 1e-9);
  assert.ok(Math.abs(bomb.position.z + 12) < 1e-9);
  assert.ok(Math.abs(bomb.position.y - (99.2 + 3 - BOMB_GRAVITY / 2)) < 1e-9);
  assert.ok(Math.abs(bomb.velocity.y - (3 - BOMB_GRAVITY)) < 1e-9);
});

test('a long frame finds the swept ground impact and scores each target only once', () => {
  const state = createWeaponState();
  const target = TARGETS[0];
  dropBomb(state, { ...target.position, y: 12 }, still);
  assert.deepEqual(stepWeapons(state, 1.5, () => 2), { impacts: 1, hits: 1 });
  assert.equal(state.bombs.length, 0);
  assert.equal(state.score, 100);
  assert.deepEqual(state.hitTargetIds, [target.id]);
  assert.equal(state.explosions[0].position.y, 2);
  assert.equal(state.explosions[0].hitCount, 1);

  dropBomb(state, { ...target.position, y: 12 }, still);
  assert.deepEqual(stepWeapons(state, 1.5, () => 2), { impacts: 1, hits: 0 });
  assert.equal(state.score, 100);
  assert.deepEqual(state.hitTargetIds, [target.id]);
  assert.equal(state.explosions[0].hitCount, 0);
});

test('the impact occurs along the trajectory rather than at a distant frame endpoint', () => {
  const state = createWeaponState();
  const target = TARGETS[0];
  dropBomb(state, { x: -10, y: 9.8, z: target.position.z }, { x: 10, y: 0, z: 0 });
  // Spawn height is 9: gravity 18 reaches the ground after exactly one second.
  assert.deepEqual(stepWeapons(state, 2, flatGround), { impacts: 1, hits: 1 });
  assert.ok(Math.abs(state.explosions[0].position.x) < 1e-5);
  assert.ok(state.explosions[0].age > 0.99 && state.explosions[0].age < 1.01);
});

test('a raised terrain section can intercept a bomb before it reaches lower ground', () => {
  const state = createWeaponState();
  dropBomb(state, { x: 0, y: 5, z: 500 }, { x: 60, y: 0, z: 0 });
  const ridge = (x: number) => x >= 2 && x <= 3 ? 6 : 0;
  assert.deepEqual(stepWeapons(state, 0.1, ridge), { impacts: 1, hits: 0 });
  assert.ok(state.explosions[0].position.x >= 2 && state.explosions[0].position.x <= 3);
  assert.equal(state.explosions[0].position.y, 6);
});

test('blast radius has a defined boundary and distant targets remain unhit', () => {
  const target = TARGETS[0];
  for (const [offset, expectedHits] of [[BLAST_RADIUS, 1], [BLAST_RADIUS + 0.01, 0]]) {
    const state = createWeaponState();
    dropBomb(state, { x: target.position.x + offset, y: 0.8, z: target.position.z }, still);
    assert.equal(stepWeapons(state, 1 / 60, flatGround).hits, expectedHits);
    assert.equal(state.score, expectedHits * 100);
  }
});

test('the sixth drop starts automatic reload and restores six rounds after three seconds', () => {
  const state = createWeaponState();
  for (let index = 0; index < BOMB_CAPACITY; index++) {
    assert.equal(dropBomb(state, { x: 500, y: 100, z: 500 }, still), true);
    if (index < BOMB_CAPACITY - 1) stepWeapons(state, DROP_COOLDOWN, flatGround);
  }
  assert.equal(state.ammo, 0);
  assert.equal(state.reloadRemaining, RELOAD_TIME);
  assert.equal(dropBomb(state, { x: 0, y: 12, z: 55 }, still), false);
  stepWeapons(state, RELOAD_TIME - 0.01, flatGround);
  assert.equal(state.ammo, 0);
  assert.ok(state.reloadRemaining > 0);
  stepWeapons(state, 0.02, flatGround);
  assert.equal(state.ammo, BOMB_CAPACITY);
  assert.equal(state.reloadRemaining, 0);
  assert.equal(dropBomb(state, { x: 0, y: 12, z: 55 }, still), true);
});

test('frame-sized timer updates do not leave cooldown or reload stuck on numeric residues', () => {
  const state = createWeaponState();
  for (let index = 0; index < BOMB_CAPACITY; index++) {
    assert.equal(dropBomb(state, { x: 500, y: 100, z: 500 }, still), true);
    if (index < BOMB_CAPACITY - 1) {
      for (let frame = 0; frame < 27; frame++) stepWeapons(state, 1 / 60, flatGround);
      assert.equal(state.cooldown, 0);
    }
  }
  for (let frame = 0; frame < 180; frame++) stepWeapons(state, 1 / 60, flatGround);
  assert.equal(state.reloadRemaining, 0);
  assert.equal(state.ammo, BOMB_CAPACITY);
});

test('explosions expire and all five fictional practice targets can be scored', () => {
  const state = createWeaponState();
  for (const target of TARGETS) {
    assert.equal(dropBomb(state, { ...target.position, y: 0.8 }, still), true);
    assert.deepEqual(stepWeapons(state, DROP_COOLDOWN, flatGround), { impacts: 1, hits: 1 });
  }
  assert.equal(state.score, 500);
  assert.deepEqual(state.hitTargetIds, TARGETS.map(target => target.id));
  stepWeapons(state, EXPLOSION_LIFETIME, flatGround);
  assert.equal(state.explosions.length, 0);
});

test('paused or invalid time and invalid drops cannot change state', () => {
  const state = createWeaponState();
  dropBomb(state, { x: 0, y: 12, z: 55 }, still);
  const before = structuredClone(state);
  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(stepWeapons(state, dt, flatGround), { impacts: 0, hits: 0 });
    assert.deepEqual(state, before);
  }
  assert.equal(dropBomb(createWeaponState(), { x: Number.NaN, y: 12, z: 55 }, still), false);
  assert.equal(dropBomb(createWeaponState(), { x: 0, y: 12, z: 55 }, { x: 0, y: Infinity, z: 0 }), false);
});

test('long flights cannot grow the active projectile list beyond its limit', () => {
  const state = createWeaponState();
  for (let index = 0; index < MAX_ACTIVE_BOMBS; index++) {
    assert.equal(dropBomb(state, { x: 500, y: 100_000, z: 500 }, still), true);
    stepWeapons(state, state.ammo === 0 ? RELOAD_TIME : DROP_COOLDOWN, flatGround);
  }
  assert.equal(state.bombs.length, MAX_ACTIVE_BOMBS);
  const ammo = state.ammo;
  assert.equal(dropBomb(state, { x: 500, y: 100_000, z: 500 }, still), false);
  assert.equal(state.ammo, ammo);
});
