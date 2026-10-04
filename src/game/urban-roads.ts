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

const JUNCTION_Z = [-210, -430, -870];

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
  const surfaces: RoadRectangle[] = [{ x: 0, z: -580, width: 44, depth: 1560 }];
  const kerbs: RoadRectangle[] = [], markings: RoadMarking[] = [], intersections: RoadIntersection[] = [];
  const mainGaps = JUNCTION_Z.map(z => [z - 25.5, z + 25.5] as const);
  for (const [start, end] of openSegments(-1360, 200, mainGaps)) {
    for (const side of [-1, 1]) kerbs.push({ x: side * 24, z: (start + end) / 2, width: 3.5, depth: end - start });
  }
  for (const [start, end] of openSegments(-1360, 200, JUNCTION_Z.map(z => [z - 31, z + 31] as const))) {
    for (const side of [-1, 1]) markings.push({ kind: 'edge', x: side * 19.5, z: (start + end) / 2, width: 0.13, depth: end - start });
  }
  for (let z = 140; z > -1320; z -= 24) {
    if (JUNCTION_Z.some(center => Math.abs(z - center) < 31 + 4.5)) continue;
    markings.push({ kind: 'center', x: 0, z, width: 0.23, depth: 9 });
  }

  for (const z of JUNCTION_Z) {
    surfaces.push({ x: (west + east) / 2, z, width: east - west, depth: 26 });
    for (const [start, end] of openSegments(west, east, [[-34, 34]])) {
      for (const side of [-1, 1]) kerbs.push({ x: (start + end) / 2, z: z + side * 15, width: end - start, depth: 3.5 });
    }
    for (let x = west + 15; x < east - 10; x += 22) {
      if (Math.abs(x) < 40) continue;
      markings.push({ kind: 'center', x, z, width: 7, depth: 0.18 });
    }
    const crossings: RoadCrossing[] = [
      { direction: 'north', x: 0, z: z - 20.5, width: 37, depth: 5 },
      { direction: 'south', x: 0, z: z + 20.5, width: 37, depth: 5 },
      { direction: 'west', x: -29.5, z, width: 5, depth: 21 },
      { direction: 'east', x: 29.5, z, width: 5, depth: 21 },
    ];
    intersections.push({ x: 0, z, width: 44, depth: 26, crossings });
    for (const crossing of crossings) {
      if (crossing.direction === 'north' || crossing.direction === 'south') {
        for (let x = -18; x <= 18; x += 2) markings.push({ kind: 'zebra', x, z: crossing.z, width: 1, depth: 5 });
      } else {
        for (let dz = -10; dz <= 10; dz += 2) markings.push({ kind: 'zebra', x: crossing.x, z: z + dz, width: 5, depth: 1 });
      }
    }
    // Stop bars sit on the incoming half of each road, before the crossing.
    markings.push(
      { kind: 'stop', x: -10, z: z - 27.5, width: 18, depth: 0.45 },
      { kind: 'stop', x: 10, z: z + 27.5, width: 18, depth: 0.45 },
      { kind: 'stop', x: -36.5, z: z + 6, width: 0.45, depth: 10 },
      { kind: 'stop', x: 36.5, z: z - 6, width: 0.45, depth: 10 },
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
