import assert from 'node:assert/strict';
import test from 'node:test';
import { getUrbanRoadNetwork } from '../src/game/urban-roads.ts';
import type { RoadRectangle } from '../src/game/urban-roads.ts';
import { HARBOR_SHORE_X, getMapLayout } from '../src/game/map-layout.ts';
import type { UrbanBox } from '../src/game/map-layout.ts';
import { getMapSpec } from '../src/game/map-catalog.ts';

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
  test(`${mapId} has twenty-one open four-way crossroads with pedestrian crossings on every arm`, () => {
    const roads = getUrbanRoadNetwork(mapId);
    assert.equal(roads.intersections.length, 21);
    for (const junction of roads.intersections) {
      assert.deepEqual(junction.crossings.map(crossing => crossing.direction), ['north', 'south', 'west', 'east']);
      assert.ok(roads.surfaces.filter(surface => contains(surface, junction)).length >= 2,
        'both perpendicular roads span the whole intersection');
      for (const direction of [-1, 1]) {
        assert.ok(roads.surfaces.some(surface => contains(surface,
          { x: junction.x + direction * 60, z: junction.z, width: 12, depth: 12 })), 'east and west approaches remain open');
        assert.ok(roads.surfaces.some(surface => contains(surface,
          { x: junction.x, z: junction.z + direction * 60, width: 12, depth: 12 })), 'north and south approaches remain open');
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
      const stops = roads.markings.filter(marking => marking.kind === 'stop'
        && Math.abs(marking.z - junction.z) < 30 && Math.abs(marking.x - junction.x) < 40);
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
        `${mapId} ${crossing.direction} crossing at ${junction.x}/${junction.z} is covered by a solid at ${solid.x}/${solid.z}`);
    }
  });

  test(`${mapId} connects the outer districts without widening streets or inventing central crossroads`, () => {
    const roads = getUrbanRoadNetwork(mapId), map = getMapSpec(mapId);
    const avenues = roads.surfaces.filter(road => road.depth > road.width);
    const streets = roads.surfaces.filter(road => road.width > road.depth);
    assert.deepEqual(avenues.map(road => road.x).sort((a, b) => a - b),
      mapId === 'factory' ? [-1450, 0, 1450] : [-2400, -1200, 0]);
    assert.ok(avenues.every(road => road.width === 44 && road.depth === 6400 && road.z === -700));
    assert.equal(streets.length, 9);
    assert.ok(streets.every(road => road.depth === 26));
    const actualIntersections = avenues.flatMap(avenue => streets.filter(street => overlaps(avenue, street))
      .map(street => `${avenue.x}/${street.z}`)).sort();
    assert.deepEqual(roads.intersections.map(junction => `${junction.x}/${junction.z}`).sort(), actualIntersections,
      'every actual road intersection has exactly one four-arm crossing layout');
    assert.ok(roads.markings.every(marking => roads.surfaces.some(surface => contains(surface, marking))),
      'expanded lane lines, zebra stripes and stop bars remain on paved roads');
    const outerZ = [-3200, -2400, -1800, 600, 1400, 2200];
    for (const z of outerZ) {
      const road = streets.find(street => street.z === z);
      assert.ok(road);
      assert.equal(road.x - road.width / 2, -3200);
      assert.equal(road.x + road.width / 2, mapId === 'factory' ? 3200 : 140);
      assert.equal(roads.intersections.filter(junction => junction.z === z).length, 3);
    }
    const core = roads.intersections.filter(junction => [-210, -430, -870].includes(junction.z));
    assert.equal(core.length, 3, 'short core streets have only their original central crossroads');
    assert.ok(core.every(junction => junction.x === 0 && junction.width === 44 && junction.depth === 26));
    for (const rect of [...roads.surfaces, ...roads.kerbs, ...roads.markings]) {
      assert.ok(rect.x - rect.width / 2 >= map.bounds.minX && rect.x + rect.width / 2 <= map.bounds.maxX
        && rect.z - rect.depth / 2 >= map.bounds.minZ && rect.z + rect.depth / 2 <= map.bounds.maxZ,
      `road rectangle stays inside the flight area: ${JSON.stringify(rect)}`);
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
