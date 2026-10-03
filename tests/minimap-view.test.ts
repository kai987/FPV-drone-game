import assert from 'node:assert/strict';
import test from 'node:test';
import { WORLD_BOUNDS } from '../src/game/landscape.ts';
import {
  ZOOM_LEVELS, ROUTE_BOUNDS, MAP_PADDING, MAP_WIDTH, MAP_HEIGHT,
  createProjection, getMapBounds, isOutsideBounds, formatMapSpan,
} from '../src/components/minimap-view.ts';

test('1× restores the original world and route presets independently of drone position', () => {
  assert.deepEqual(getMapBounds('world', 1, { x: 1700, z: -2400 }, WORLD_BOUNDS), {
    minX: WORLD_BOUNDS.minX, maxX: WORLD_BOUNDS.maxX, minZ: WORLD_BOUNDS.minZ, maxZ: WORLD_BOUNDS.maxZ,
  });
  assert.deepEqual(getMapBounds('route', 1, { x: 1700, z: -2400 }, WORLD_BOUNDS), ROUTE_BOUNDS);
  assert.equal(isOutsideBounds({ x: 1700, z: -2400 }, ROUTE_BOUNDS), true);
});

test('each multiplier changes the actual visible span and follows the drone when zoomed', () => {
  const drone = { x: 680, z: -1240 };
  for (const view of ['world', 'route'] as const) {
    const base = view === 'world' ? WORLD_BOUNDS : ROUTE_BOUNDS;
    for (const factor of ZOOM_LEVELS.slice(1)) {
      const bounds = getMapBounds(view, factor, drone, WORLD_BOUNDS);
      assert.equal(bounds.maxX - bounds.minX, (base.maxX - base.minX) / factor);
      assert.equal(bounds.maxZ - bounds.minZ, (base.maxZ - base.minZ) / factor);
      assert.equal((bounds.minX + bounds.maxX) / 2, drone.x);
      assert.equal((bounds.minZ + bounds.maxZ) / 2, drone.z);
    }
  }
  assert.equal(formatMapSpan(getMapBounds('world', 1, drone, WORLD_BOUNDS)), '3.6 km');
  assert.equal(formatMapSpan(getMapBounds('route', 8, drone, WORLD_BOUNDS)), '75 m');
});

test('zoomed views stay inside the world and retain the drone arrow at every border and corner', () => {
  const positions = [
    { x: WORLD_BOUNDS.minX, z: WORLD_BOUNDS.minZ }, { x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.minZ },
    { x: WORLD_BOUNDS.minX, z: WORLD_BOUNDS.maxZ }, { x: WORLD_BOUNDS.maxX, z: WORLD_BOUNDS.maxZ },
    { x: 0, z: WORLD_BOUNDS.minZ }, { x: 0, z: WORLD_BOUNDS.maxZ },
    { x: WORLD_BOUNDS.minX, z: -700 }, { x: WORLD_BOUNDS.maxX, z: -700 },
  ];
  for (const view of ['world', 'route'] as const) for (const factor of ZOOM_LEVELS.slice(1)) for (const drone of positions) {
    const bounds = getMapBounds(view, factor, drone, WORLD_BOUNDS);
    assert.ok(bounds.minX >= WORLD_BOUNDS.minX && bounds.maxX <= WORLD_BOUNDS.maxX);
    assert.ok(bounds.minZ >= WORLD_BOUNDS.minZ && bounds.maxZ <= WORLD_BOUNDS.maxZ);
    assert.equal(isOutsideBounds(drone, bounds), false);
    const point = createProjection(bounds).project(drone.x, drone.z);
    // The 9px arrow halo remains inside the padded SVG even on the world edge.
    assert.ok(point.x >= MAP_PADDING && point.x <= MAP_WIDTH - MAP_PADDING);
    assert.ok(point.y >= MAP_PADDING && point.y <= MAP_HEIGHT - MAP_PADDING);
  }
});

test('route zoom follows a drone far beyond the race instead of clipping its position', () => {
  const drone = { x: -1430, z: 870 };
  assert.equal(isOutsideBounds(drone, getMapBounds('route', 1, drone, WORLD_BOUNDS)), true);
  for (const factor of ZOOM_LEVELS.slice(1)) {
    const bounds = getMapBounds('route', factor, drone, WORLD_BOUNDS);
    assert.equal(isOutsideBounds(drone, bounds), false);
    const point = createProjection(bounds).project(drone.x, drone.z);
    assert.equal(point.x, MAP_WIDTH / 2);
    assert.equal(point.y, MAP_HEIGHT / 2);
  }
});
