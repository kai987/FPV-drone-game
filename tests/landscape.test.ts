import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKPOINTS } from '../src/game/world.ts';
import { createFlightState, stepFlight } from '../src/game/flight.ts';
import { TARGETS, createWeaponState, dropBomb, stepWeapons } from '../src/game/weapons.ts';
import {
  LAKES, RIVER_POINTS, RIVER_SAMPLES, TERRAIN_SIZE, WATER_LEVEL, WORLD_BOUNDS, WORLD_CENTER_Z,
  groundHeight, isWater, lakeBoundary, riverWidth, surfaceHeight, waterDistance,
} from '../src/game/landscape.ts';

test('the larger flight bounds fit within the terrain and keep a generous altitude ceiling', () => {
  assert.equal(TERRAIN_SIZE, 4200);
  assert.equal(WORLD_CENTER_Z, -700);
  assert.ok(WORLD_BOUNDS.minX > -TERRAIN_SIZE / 2);
  assert.ok(WORLD_BOUNDS.maxX < TERRAIN_SIZE / 2);
  assert.ok(WORLD_BOUNDS.minZ > WORLD_CENTER_Z - TERRAIN_SIZE / 2);
  assert.ok(WORLD_BOUNDS.maxZ < WORLD_CENTER_Z + TERRAIN_SIZE / 2);
  let highest = -Infinity;
  for (let x = WORLD_BOUNDS.minX; x <= WORLD_BOUNDS.maxX; x += 60) {
    for (let z = WORLD_BOUNDS.minZ; z <= WORLD_BOUNDS.maxZ; z += 60) {
      const height = groundHeight(x, z);
      assert.ok(Number.isFinite(height));
      assert.ok(height < WORLD_BOUNDS.maxAltitude - 50);
      assert.ok(Math.abs(groundHeight(x + 1, z) - height) < 5, 'Terrain must not jump across a one-metre step');
      assert.ok(Math.abs(groundHeight(x, z + 1) - height) < 5, 'Terrain must not jump across a one-metre step');
      highest = Math.max(highest, height);
    }
  }
  assert.ok(highest > 180, 'The expanded map should contain meaningful ridges');
});

test('the main river stays connected through both lakes with a varied channel width', () => {
  assert.ok(RIVER_SAMPLES.length > 300);
  for (const sample of RIVER_SAMPLES) {
    assert.ok(isWater(sample.x, sample.z));
    assert.ok(waterDistance(sample.x, sample.z) < -10);
    assert.ok(sample.halfWidth >= 18 && sample.halfWidth <= 32);
    assert.equal(sample.halfWidth, riverWidth(sample.z));
  }
  for (let index = 1; index < RIVER_SAMPLES.length; index++) {
    const a = RIVER_SAMPLES[index - 1];
    const b = RIVER_SAMPLES[index];
    assert.ok(b.z > a.z);
    for (const fraction of [0.25, 0.5, 0.75]) {
      assert.ok(isWater(a.x + (b.x - a.x) * fraction, a.z + (b.z - a.z) * fraction));
    }
  }
  for (const lake of LAKES) {
    assert.ok(isWater(lake.x, lake.z));
    assert.ok(RIVER_POINTS.some(point => {
      const cosine = Math.cos(lake.rotation);
      const sine = Math.sin(lake.rotation);
      const dx = point.x - lake.x;
      const dz = point.z - lake.z;
      return Math.hypot((dx * cosine + dz * sine) / lake.radiusX,
        (-dx * sine + dz * cosine) / lake.radiusZ) < 0.8;
    }), 'A river control point must connect each lake to the channel');
  }
});

test('irregular lake boundaries share the geography mask and beds are continuous at lake centres', () => {
  for (const lake of LAKES) {
    const boundary = lakeBoundary(lake);
    assert.equal(boundary.length, 96);
    const normalizedRadii: number[] = [];
    let exposedShorePoints = 0;
    for (const point of boundary) {
      assert.equal(point.y, WATER_LEVEL);
      assert.ok(waterDistance(point.x, point.z) <= 1e-9);
      if (Math.abs(waterDistance(point.x, point.z)) < 1e-8) {
        assert.ok(Math.abs(groundHeight(point.x, point.z) - WATER_LEVEL) < 1e-8);
        exposedShorePoints++;
      }
      const dx = point.x - lake.x;
      const dz = point.z - lake.z;
      normalizedRadii.push(Math.hypot((dx * Math.cos(lake.rotation) + dz * Math.sin(lake.rotation)) / lake.radiusX,
        (-dx * Math.sin(lake.rotation) + dz * Math.cos(lake.rotation)) / lake.radiusZ));
    }
    assert.ok(exposedShorePoints > 40);
    assert.ok(Math.max(...normalizedRadii) - Math.min(...normalizedRadii) > 0.15);
    const center = groundHeight(lake.x, lake.z);
    for (const [dx, dz] of [[0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01]]) {
      assert.ok(Math.abs(groundHeight(lake.x + dx, lake.z + dz) - center) < 0.01);
    }
  }
});

test('spawn, the original gates, and the practice targets remain dry and safely above terrain', () => {
  for (let z = 55; z >= -115; z -= 5) {
    assert.equal(isWater(0, z), false);
    assert.ok(groundHeight(0, z) < 5);
    assert.ok(groundHeight(0, z) > WATER_LEVEL);
  }
  for (const checkpoint of CHECKPOINTS) {
    assert.equal(isWater(checkpoint.position.x, checkpoint.position.z), false);
    assert.ok(checkpoint.position.y > surfaceHeight(checkpoint.position.x, checkpoint.position.z) + 1.8);
  }
  for (const target of TARGETS) {
    assert.equal(isWater(target.position.x, target.position.z), false);
    assert.ok(groundHeight(target.position.x, target.position.z) > WATER_LEVEL);
  }
  assert.ok(waterDistance(80, -230) > 20);
  assert.ok(waterDistance(130, -360) > 20);
});

test('water beds lie below the surface and dry shores lie above it', () => {
  for (let x = -1200; x <= 1200; x += 80) {
    for (let z = -2300; z <= 1000; z += 80) {
      const distance = waterDistance(x, z);
      const ground = groundHeight(x, z);
      if (distance < -0.01) {
        assert.ok(ground < WATER_LEVEL);
        assert.equal(surfaceHeight(x, z), WATER_LEVEL);
      } else if (distance > 0.01) {
        assert.ok(ground > WATER_LEVEL);
        assert.equal(surfaceHeight(x, z), ground);
      }
    }
  }
});

test('a dropped game bomb and a descending drone contact the lake surface instead of its bed', () => {
  const lake = LAKES[0];
  assert.ok(groundHeight(lake.x, lake.z) < WATER_LEVEL - 5);
  const weapons = createWeaponState();
  dropBomb(weapons, { x: lake.x, y: 12, z: lake.z }, { x: 0, y: 0, z: 0 });
  assert.deepEqual(stepWeapons(weapons, 1.5, surfaceHeight), { impacts: 1, hits: 0 });
  assert.equal(weapons.bombs.length, 0);
  assert.equal(weapons.explosions[0].position.y, WATER_LEVEL);

  const drone = createFlightState({ x: lake.x, y: 12, z: lake.z });
  let contacts = 0;
  for (let frame = 0; frame < 240; frame++) {
    stepFlight(drone, { forward: 0, strafe: 0, climb: -1, yaw: 0 }, 1 / 60, 'assisted', surfaceHeight);
    assert.ok(drone.position.y >= WATER_LEVEL + 1.8);
    if (drone.collision) contacts++;
  }
  assert.ok(contacts > 0);
});
