/** Metre-scaled road geometry, shared by the scenery and map overview. */
export interface RoadRectangle { x: number; z: number; width: number; depth: number; }
export interface RoadMarking extends RoadRectangle { kind: 'center' | 'edge' | 'zebra' | 'stop'; }
export interface RoadCrossing extends RoadRectangle { direction: 'north' | 'south' | 'east' | 'west'; }
export interface RoadIntersection extends RoadRectangle { crossings: readonly RoadCrossing[]; }
export interface UrbanRoadNetwork {
  surfaces: readonly RoadRectangle[];
  kerbs: readonly RoadRectangle[];
  markings: readonly RoadMarking[];
  intersections: readonly RoadIntersection[];
}

const CORE_CROSS_STREETS_Z = [-210, -430, -870];
const OUTER_CROSS_STREETS_Z = [-3200, -2400, -1800, 600, 1400, 2200];

interface AxisRoad { coordinate: number; start: number; end: number; }

function openSegments(start: number, end: number, gaps: readonly (readonly [number, number])[]): [number, number][] {
  const result: [number, number][] = [];
  let cursor = start;
  for (const [gapStart, gapEnd] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (gapStart > cursor) result.push([cursor, Math.min(gapStart, end)]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < end) result.push([cursor, end]);
  return result.filter(([a, b]) => b > a);
}

function createRoadNetwork(harbor: boolean): UrbanRoadNetwork {
  const west = harbor ? -400 : -455, east = harbor ? 140 : 455;
  const verticalRoads: AxisRoad[] = (harbor ? [0, -1200, -2400] : [0, -1450, 1450])
    .map(coordinate => ({ coordinate, start: -3900, end: 2500 }));
  const horizontalRoads: AxisRoad[] = [
    ...CORE_CROSS_STREETS_Z.map(coordinate => ({ coordinate, start: west, end: east })),
    ...OUTER_CROSS_STREETS_Z.map(coordinate => ({ coordinate, start: -3200, end: harbor ? 140 : 3200 })),
  ];
  const surfaces: RoadRectangle[] = [
    ...verticalRoads.map(road => ({ x: road.coordinate, z: (road.start + road.end) / 2, width: 44, depth: road.end - road.start })),
    ...horizontalRoads.map(road => ({ x: (road.start + road.end) / 2, z: road.coordinate, width: road.end - road.start, depth: 26 })),
  ];
  const kerbs: RoadRectangle[] = [], markings: RoadMarking[] = [], intersections: RoadIntersection[] = [];
  // Derive junctions from the actual road spans: short central streets do not
  // cross the distant parallel avenues, and harbor roads remain onshore.
  for (const horizontal of horizontalRoads) for (const vertical of verticalRoads) {
    if (vertical.coordinate <= horizontal.start || vertical.coordinate >= horizontal.end
      || horizontal.coordinate <= vertical.start || horizontal.coordinate >= vertical.end) continue;
    const x = vertical.coordinate, z = horizontal.coordinate;
    const crossings: RoadCrossing[] = [
      { direction: 'north', x, z: z - 20.5, width: 37, depth: 5 },
      { direction: 'south', x, z: z + 20.5, width: 37, depth: 5 },
      { direction: 'west', x: x - 29.5, z, width: 5, depth: 21 },
      { direction: 'east', x: x + 29.5, z, width: 5, depth: 21 },
    ];
    intersections.push({ x, z, width: 44, depth: 26, crossings });
  }

  for (const road of verticalRoads) {
    const crossingZ = intersections.filter(junction => junction.x === road.coordinate).map(junction => junction.z);
    for (const [start, end] of openSegments(road.start, road.end, crossingZ.map(z => [z - 25.5, z + 25.5] as const))) {
      for (const side of [-1, 1]) kerbs.push({ x: road.coordinate + side * 24, z: (start + end) / 2, width: 3.5, depth: end - start });
    }
    for (const [start, end] of openSegments(road.start, road.end, crossingZ.map(z => [z - 31, z + 31] as const))) {
      for (const side of [-1, 1]) markings.push({ kind: 'edge', x: road.coordinate + side * 19.5, z: (start + end) / 2, width: 0.13, depth: end - start });
    }
    // Keep the original dash phase while extending it across the larger map.
    const firstDash = 140 + Math.floor((road.end - 40 - 140) / 24) * 24;
    for (let z = firstDash; z > road.start + 40; z -= 24) {
      if (crossingZ.some(center => Math.abs(z - center) < 31 + 4.5)) continue;
      markings.push({ kind: 'center', x: road.coordinate, z, width: 0.23, depth: 9 });
    }
  }

  for (const road of horizontalRoads) {
    const crossingX = intersections.filter(junction => junction.z === road.coordinate).map(junction => junction.x);
    for (const [start, end] of openSegments(road.start, road.end, crossingX.map(x => [x - 34, x + 34] as const))) {
      for (const side of [-1, 1]) kerbs.push({ x: (start + end) / 2, z: road.coordinate + side * 15, width: end - start, depth: 3.5 });
    }
    for (let x = road.start + 15; x < road.end - 10; x += 22) {
      if (crossingX.some(center => Math.abs(x - center) < 40)) continue;
      markings.push({ kind: 'center', x, z: road.coordinate, width: 7, depth: 0.18 });
    }
  }

  for (const { x: junctionX, z, crossings } of intersections) {
    for (const crossing of crossings) {
      if (crossing.direction === 'north' || crossing.direction === 'south') {
        for (let dx = -18; dx <= 18; dx += 2) markings.push({ kind: 'zebra', x: junctionX + dx, z: crossing.z, width: 1, depth: 5 });
      } else {
        for (let dz = -10; dz <= 10; dz += 2) markings.push({ kind: 'zebra', x: crossing.x, z: z + dz, width: 5, depth: 1 });
      }
    }
    // Stop bars sit on the incoming half of each road, before the crossing.
    markings.push(
      { kind: 'stop', x: junctionX - 10, z: z - 27.5, width: 18, depth: 0.45 },
      { kind: 'stop', x: junctionX + 10, z: z + 27.5, width: 18, depth: 0.45 },
      { kind: 'stop', x: junctionX - 36.5, z: z + 6, width: 0.45, depth: 10 },
      { kind: 'stop', x: junctionX + 36.5, z: z - 6, width: 0.45, depth: 10 },
    );
  }
  return { surfaces, kerbs, markings, intersections };
}

const FACTORY_ROADS = createRoadNetwork(false), HARBOR_ROADS = createRoadNetwork(true);
const EMPTY_ROADS: UrbanRoadNetwork = { surfaces: [], kerbs: [], markings: [], intersections: [] };

export function getUrbanRoadNetwork(mapId: string): UrbanRoadNetwork {
  if (mapId === 'factory') return FACTORY_ROADS;
  if (mapId === 'harbor') return HARBOR_ROADS;
  return EMPTY_ROADS;
}

/** Keep ground-level street furniture outside the paved road and its footway. */
export function isUrbanRoadArea(mapId: string, x: number, z: number, padding = 0): boolean {
  return getUrbanRoadNetwork(mapId).surfaces.some(surface => Math.abs(x - surface.x) <= surface.width / 2 + padding
    && Math.abs(z - surface.z) <= surface.depth / 2 + padding);
}
