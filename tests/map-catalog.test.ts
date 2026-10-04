import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKPOINTS } from '../src/game/courses.ts';
import { DEFAULT_MAP_ID, MAPS, getMapSpec } from '../src/game/map-catalog.ts';
import { TARGETS } from '../src/game/weapons.ts';

test('the original valley course and targets retain their identity for existing flights and records', () => {
  const valley = getMapSpec(DEFAULT_MAP_ID);
  assert.equal(valley.id, 'valley');
  assert.equal(valley.checkpoints, CHECKPOINTS);
  assert.equal(valley.targets, TARGETS);
});

test('each selectable map has a complete course and usable map bounds', () => {
  assert.deepEqual(MAPS.map(map => map.id), ['valley', 'factory', 'harbor']);
  const allTargetIds = new Set<string>();
  for (const map of MAPS) {
    assert.equal(map.checkpoints.length, 8);
    assert.ok(map.targets.length > 0);
    const inside = (x: number, z: number) => x >= map.routeBounds.minX && x <= map.routeBounds.maxX && z >= map.routeBounds.minZ && z <= map.routeBounds.maxZ;
    assert.ok(inside(map.spawn.x, map.spawn.z), `${map.id} spawn is visible in its route overview`);
    assert.ok(map.routeBounds.minX >= map.bounds.minX && map.routeBounds.maxX <= map.bounds.maxX);
    assert.ok(map.routeBounds.minZ >= map.bounds.minZ && map.routeBounds.maxZ <= map.bounds.maxZ);
    for (const checkpoint of map.checkpoints) {
      assert.ok(inside(checkpoint.position.x, checkpoint.position.z), `${map.id} checkpoint is visible`);
      assert.ok(checkpoint.radius > 0 && Number.isFinite(checkpoint.yaw));
      assert.ok(checkpoint.position.y > checkpoint.radius && checkpoint.position.y < map.bounds.maxAltitude);
    }
    for (const target of map.targets) {
      assert.ok(inside(target.position.x, target.position.z), `${map.id} target is visible`);
      assert.equal(allTargetIds.has(target.id), false, `target ${target.id} is unique across maps`);
      allTargetIds.add(target.id);
    }
  }
  assert.notDeepEqual(getMapSpec('factory').checkpoints, getMapSpec('valley').checkpoints);
  assert.notDeepEqual(getMapSpec('harbor').checkpoints, getMapSpec('factory').checkpoints);
});
