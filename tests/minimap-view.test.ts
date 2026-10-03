import assert from 'node:assert/strict';
import test from 'node:test';
import { WORLD_BOUNDS } from '../src/game/landscape.ts';
import {
  ZOOM_LEVELS, ROUTE_BOUNDS, MAP_PADDING, MAP_WIDTH, MAP_HEIGHT,
  beginMapDrag, centerMapBounds, createProjection, getMapBounds, getMapCenter, hasPanGesture, isOutsideBounds, formatMapSpan, panMapBounds,
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

test('pointer movement pans real coordinates by the displayed scale on desktop, phone and letterboxed SVGs', () => {
  const bounds = getMapBounds('route', 4, { x: 680, z: -1240 }, WORLD_BOUNDS);
  const marker = { x: 650, z: -1220 };
  for (const viewport of [{ width: 180, height: 150 }, { width: 360, height: 300 }, { width: 90, height: 75 }, { width: 360, height: 200 }]) {
    const dx = 12; const dy = 8;
    const moved = panMapBounds(bounds, dx, dy, viewport, WORLD_BOUNDS);
    const before = createProjection(bounds).project(marker.x, marker.z);
    const after = createProjection(moved).project(marker.x, marker.z);
    const svgScale = Math.min(viewport.width / MAP_WIDTH, viewport.height / MAP_HEIGHT);
    assert.ok(Math.abs((after.x - before.x) * svgScale - dx) < 1e-9);
    assert.ok(Math.abs((after.y - before.y) * svgScale - dy) < 1e-9);
    assert.ok(getMapCenter(moved).x < getMapCenter(bounds).x, 'Dragging right pulls western ground into view');
    assert.ok(getMapCenter(moved).z < getMapCenter(bounds).z, 'Dragging down pulls northern ground into view');
  }
});

test('long drags clamp at every world edge without changing the viewport span', () => {
  const bounds = getMapBounds('world', 8, { x: 0, z: -700 }, WORLD_BOUNDS);
  for (const dx of [-10000, 10000]) for (const dy of [-10000, 10000]) {
    const moved = panMapBounds(bounds, dx, dy, { width: 90, height: 75 }, WORLD_BOUNDS);
    assert.equal(moved.maxX - moved.minX, 450);
    assert.equal(moved.maxZ - moved.minZ, 450);
    assert.equal(dx > 0 ? moved.minX : moved.maxX, dx > 0 ? WORLD_BOUNDS.minX : WORLD_BOUNDS.maxX);
    assert.equal(dy > 0 ? moved.minZ : moved.maxZ, dy > 0 ? WORLD_BOUNDS.minZ : WORLD_BOUNDS.maxZ);
  }
  const overview = getMapBounds('world', 1, { x: 0, z: 0 }, WORLD_BOUNDS);
  assert.deepEqual(panMapBounds(overview, 42, -80, { width: 180, height: 150 }, WORLD_BOUNDS), overview);
  assert.deepEqual(panMapBounds(bounds, 42, -80, { width: 0, height: 0 }, WORLD_BOUNDS), bounds);
});

test('manual zoom retains its world center independently of telemetry and can explicitly resume following', () => {
  const center = { x: -900, z: -1100 };
  for (const factor of [1, 2, 4, 8]) {
    const bounds = getMapBounds('route', factor, { x: 680, z: 870 }, WORLD_BOUNDS, { center, follow: false });
    assert.deepEqual(getMapCenter(bounds), center);
  }
  const follow = getMapBounds('route', 1, { x: 680, z: -1240 }, WORLD_BOUNDS, { follow: true });
  assert.deepEqual(getMapCenter(follow), { x: 680, z: -1240 });
  assert.deepEqual(getMapBounds('route', 1, { x: 680, z: -1240 }, WORLD_BOUNDS, { follow: false }), ROUTE_BOUNDS);
});

test('zooming a manual border view keeps the reachable center, including zooming back in', () => {
  const drone = { x: 0, z: 55 };
  const nearBorder = getMapBounds('route', 8, drone, WORLD_BOUNDS, { center: { x: 1740, z: 1070 }, follow: false });
  const wide = getMapBounds('route', 2, drone, WORLD_BOUNDS, { center: getMapCenter(nearBorder), follow: false });
  assert.deepEqual(getMapCenter(wide), { x: 1650, z: 912.5 });
  const tight = getMapBounds('route', 8, drone, WORLD_BOUNDS, { center: getMapCenter(wide), follow: false });
  assert.deepEqual(getMapCenter(tight), getMapCenter(wide));
  assert.ok(tight.maxX <= WORLD_BOUNDS.maxX && tight.maxZ <= WORLD_BOUNDS.maxZ);
});

test('small taps do not pan, and out-of-window positions remain truly outside the projection', () => {
  assert.equal(hasPanGesture(0, 0), false);
  assert.equal(hasPanGesture(3, 2), false);
  assert.equal(hasPanGesture(4, 0), true);
  assert.equal(hasPanGesture(3, 3), true);
  const bounds = centerMapBounds(ROUTE_BOUNDS, { x: -1000, z: -1000 }, WORLD_BOUNDS);
  const outside = { x: 0, z: 55 };
  assert.equal(isOutsideBounds(outside, bounds), true);
  const projection = createProjection(bounds);
  const point = projection.project(outside.x, outside.z);
  assert.ok(point.x > projection.left + projection.width && point.y > projection.top + projection.height);
});

test('drag confirmation captures the current followed view after a long press and preserves large first movements', () => {
  const pressedAt = { x: 100, y: 100 };
  const pointerDownBounds = getMapBounds('route', 4, { x: 0, z: 55 }, WORLD_BOUNDS);
  const currentBounds = getMapBounds('route', 4, { x: 100, z: -45 }, WORLD_BOUNDS);
  assert.equal(beginMapDrag(currentBounds, pressedAt, { x: 103, y: 102 }), null);
  const beginning = beginMapDrag(currentBounds, pressedAt, { x: 120, y: 100 });
  assert.ok(beginning);
  assert.deepEqual(beginning.bounds, currentBounds);
  assert.notDeepEqual(beginning.bounds, pointerDownBounds);
  assert.deepEqual(beginning.start, { x: 104, y: 100 });
  const viewport = { width: 180, height: 150 };
  const firstPan = panMapBounds(beginning.bounds, 120 - beginning.start.x, 100 - beginning.start.y, viewport, WORLD_BOUNDS);
  const screenScale = createProjection(currentBounds).scale;
  assert.ok(Math.abs(getMapCenter(firstPan).x - (100 - 16 / screenScale)) < 1e-9);
  assert.equal(getMapCenter(firstPan).z, -45);
  // Later flight telemetry cannot change the captured basis of this gesture.
  currentBounds.minX += 100; currentBounds.maxX += 100;
  const secondPan = panMapBounds(beginning.bounds, 130 - beginning.start.x, 0, viewport, WORLD_BOUNDS);
  assert.ok(Math.abs(getMapCenter(secondPan).x - (100 - 26 / screenScale)) < 1e-9);
});

test('diagonal drag starts at the threshold without moving the current view backwards', () => {
  const bounds = getMapBounds('world', 8, { x: 80, z: -100 }, WORLD_BOUNDS);
  const beginning = beginMapDrag(bounds, { x: 10, y: 20 }, { x: 12.4, y: 23.2 });
  assert.ok(beginning);
  assert.ok(Math.abs(beginning.start.x - 12.4) < 1e-9);
  assert.ok(Math.abs(beginning.start.y - 23.2) < 1e-9);
  assert.deepEqual(panMapBounds(beginning.bounds, 0, 0, { width: 90, height: 75 }, WORLD_BOUNDS), bounds);
});
