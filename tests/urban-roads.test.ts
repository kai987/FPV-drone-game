import assert from 'node:assert/strict';
import test from 'node:test';
import { getUrbanRoadNetwork } from '../src/game/urban-roads.ts';
import type { RoadRectangle } from '../src/game/urban-roads.ts';
import { HARBOR_SHORE_X, getMapLayout } from '../src/game/map-layout.ts';
import type { UrbanBox } from '../src/game/map-layout.ts';

function overlaps(a: RoadRectangle, b: RoadRectangle): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-8
    && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - 1e-8;
}

function contains(a: RoadRectangle, b: RoadRectangle): boolean {
  return Math.abs(a.x - b.x) + b.width / 2 <= a.width / 2 + 1e-8
    && Math.abs(a.z - b.z) + b.depth / 2 <= a.depth / 2 + 1e-8;
}

function overlapsSolid(rect: RoadRectangle, box: UrbanBox): boolean {
  const yaw = box.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = box.x - rect.x, dz = box.z - rect.z;
  // Separating-axis test includes rotated ISO cargo, rather than its oversized AABB.
  const axes = [[1, 0], [0, 1], [c, -s], [s, c]];
  return axes.every(([ax, az]) => Math.abs(dx * ax + dz * az)
    < rect.width / 2 * Math.abs(ax) + rect.depth / 2 * Math.abs(az)
      + box.width / 2 * Math.abs(c * ax - s * az) + box.depth / 2 * Math.abs(s * ax + c * az) - 1e-8);
}

for (const mapId of ['factory', 'harbor'] as const) {
  test(`${mapId} has three open four-way crossroads with pedestrian crossings on every arm`, () => {
    const roads = getUrbanRoadNetwork(mapId);
    assert.equal(roads.intersections.length, 3);
    for (const junction of roads.intersections) {
      assert.deepEqual(junction.crossings.map(crossing => crossing.direction), ['north', 'south', 'west', 'east']);
      assert.ok(roads.surfaces.filter(surface => contains(surface, junction)).length >= 2,
        'both perpendicular roads span the whole intersection');
      for (const direction of [-1, 1]) {
        assert.ok(roads.surfaces.some(surface => contains(surface,
          { x: direction * 60, z: junction.z, width: 12, depth: 12 })), 'east and west approaches remain open');
        assert.ok(roads.surfaces.some(surface => contains(surface,
          { x: 0, z: junction.z + direction * 60, width: 12, depth: 12 })), 'north and south approaches remain open');
      }
      for (const crossing of junction.crossings) {
        assert.equal(overlaps(crossing, junction), false, 'zebra crossing belongs to an approach, outside the central intersection');
        assert.ok(roads.surfaces.some(surface => contains(surface, crossing)), 'every crossing is painted on asphalt');
        const stripes = roads.markings.filter(marking => marking.kind === 'zebra' && contains(crossing, marking));
        assert.ok(stripes.length >= 10, 'a full crossing has clear repeating white stripes');
        assert.ok(stripes.every(stripe => crossing.direction === 'north' || crossing.direction === 'south'
          ? stripe.depth === crossing.depth && stripe.width < stripe.depth
          : stripe.width === crossing.width && stripe.depth < stripe.width), 'stripes follow approaching traffic');
        assert.ok(roads.kerbs.every(kerb => !overlaps(kerb, crossing)), 'pedestrian paths have lowered kerb openings');
        assert.ok(roads.markings.filter(marking => marking.kind !== 'zebra').every(marking => !overlaps(marking, crossing)),
          'center and edge lines stop before the zebra crossing');
      }
      assert.ok(roads.kerbs.every(kerb => !overlaps(kerb, junction)), 'a continuous kerb does not cut off any road arm');
      assert.ok(roads.markings.every(marking => !overlaps(marking, junction)), 'junction center stays free of conflicting paint');
      const stops = roads.markings.filter(marking => marking.kind === 'stop' && Math.abs(marking.z - junction.z) < 30);
      assert.equal(stops.length, 4, 'each incoming approach has a stop bar');
    }
  });

  test(`${mapId} road lanes and crossings avoid warehouse walls, parked trucks and ground-level cargo`, () => {
    const roads = getUrbanRoadNetwork(mapId);
    const solids = getMapLayout(mapId).boxes.filter(box => box.base < 2.2 && box.base + box.height > 2.3);
    // Edge furniture and supports can sit at the outer metre of the carriageway.
    for (const surface of roads.surfaces) {
      const lanes = { ...surface, width: surface.width - 2, depth: surface.depth - 2 };
      for (const solid of solids) assert.equal(overlapsSolid(lanes, solid), false,
        `${mapId} asphalt lanes run through a solid at ${solid.x}/${solid.z}`);
    }
    for (const junction of roads.intersections) for (const crossing of junction.crossings) {
      for (const solid of solids) assert.equal(overlapsSolid(crossing, solid), false,
        `${mapId} ${crossing.direction} crossing at ${junction.z} is covered by a solid at ${solid.x}/${solid.z}`);
    }
  });
}

test('harbor road and kerb surfaces stop at the coast instead of extending over open water', () => {
  const roads = getUrbanRoadNetwork('harbor');
  for (const rect of [...roads.surfaces, ...roads.kerbs, ...roads.markings]) {
    assert.ok(rect.x + rect.width / 2 <= HARBOR_SHORE_X, `road rectangle extends offshore: ${JSON.stringify(rect)}`);
  }
});

test('the rural valley retains its natural terrain without urban road overlays', () => {
  assert.deepEqual(getUrbanRoadNetwork('valley'), { surfaces: [], kerbs: [], markings: [], intersections: [] });
});
