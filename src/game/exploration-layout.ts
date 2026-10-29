import type { UrbanBox } from './map-layout.ts';

export type ExplorationMapId = 'desert' | 'downtown' | 'mountains';
export interface TerrainPeak { readonly x: number; readonly z: number; readonly height: number; readonly radiusX: number; readonly radiusZ: number; }
export interface ExplorationSolid extends UrbanBox { readonly color: string; readonly variant: number; }
export interface BuildingRoofDetails {
  readonly cap: UrbanBox;
  readonly hvac: UrbanBox;
  readonly antenna?: UrbanBox;
}
export interface ExplorationLayout {
  readonly buildings: readonly ExplorationSolid[];
  readonly rocks: readonly ExplorationSolid[];
  readonly roads: readonly UrbanBox[];
  readonly boxes: readonly UrbanBox[];
}

/** Shared metres, used by Three.js, the minimap and the native world queries. */
export const DOWNTOWN_STREETS = Object.freeze([-2000, -1600, -1200, -800, -400, 0, 400, 800, 1200, 1600, 2000]);
export const DOWNTOWN_ROAD_WIDTH = 32;
export const DESERT_MESAS: readonly TerrainPeak[] = Object.freeze([
  { x: -1350, z: -1000, height: 135, radiusX: 290, radiusZ: 220 },
  { x: 1250, z: -1350, height: 165, radiusX: 310, radiusZ: 260 },
  { x: 1550, z: 850, height: 120, radiusX: 340, radiusZ: 240 },
  { x: -1550, z: 1250, height: 150, radiusX: 300, radiusZ: 330 },
]);
export const MOUNTAIN_PEAKS: readonly TerrainPeak[] = Object.freeze([
  { x: -1250, z: -1050, height: 560, radiusX: 510, radiusZ: 590 },
  { x: 1050, z: -1450, height: 640, radiusX: 530, radiusZ: 470 },
  { x: 1550, z: 650, height: 500, radiusX: 590, radiusZ: 520 },
  { x: -1500, z: 1050, height: 490, radiusX: 580, radiusZ: 510 },
  { x: 50, z: -2250, height: 470, radiusX: 580, radiusZ: 450 },
]);

export function isExplorationMap(id: string): id is ExplorationMapId {
  return id === 'desert' || id === 'downtown' || id === 'mountains';
}

function peakHeight(peaks: readonly TerrainPeak[], x: number, z: number): number {
  let result = 0;
  for (const peak of peaks) {
    const dx = (x - peak.x) / peak.radiusX, dz = (z - peak.z) / peak.radiusZ;
    result += peak.height * Math.exp(-(dx * dx + dz * dz));
  }
  return result;
}

/** Independent scene reference for the equivalent Rust terrain function. */
export function explorationGroundHeight(id: ExplorationMapId, x: number, z: number): number {
  if (id === 'downtown') return 2;
  if (id === 'desert') {
    const dune = 0.5 + 0.5 * Math.sin(x * 0.008 + Math.sin(z * 0.003) * 1.1);
    return 8 + dune * dune * 21 + Math.sin(z * 0.004 - x * 0.0015) * 4
      + Math.sin(x * 0.025 + z * 0.018) * 0.65 + peakHeight(DESERT_MESAS, x, z);
  }
  const foothills = 18 + Math.sin(x * 0.0034 + Math.sin(z * 0.002)) * 9
    + Math.sin(z * 0.0045 - x * 0.001) * 7;
  const peaks = peakHeight(MOUNTAIN_PEAKS, x, z);
  const ridge = Math.sin(x * 0.011 + z * 0.007) * Math.sin(z * 0.009 - x * 0.004);
  const crag = (Math.abs(Math.sin(x * 0.016 + z * 0.011)) - 0.5) * 0.018;
  return foothills + peaks * (1 + ridge * 0.15 + crag);
}

/** One metre-scaled source for the rendered roof solids and native contacts. */
export function buildingRoofDetails(building: UrbanBox): BuildingRoofDetails {
  const roof = building.base + building.height;
  return {
    cap: { x: building.x, z: building.z, width: building.width + 0.7, depth: building.depth + 0.7, base: roof, height: 0.6 },
    hvac: { x: building.x + building.width * 0.15, z: building.z,
      width: Math.min(9, building.width * 0.2), depth: Math.min(12, building.depth * 0.25), base: roof, height: 2.4 },
    ...(building.height > 130 ? { antenna: { x: building.x, z: building.z, width: 0.24, depth: 0.24, base: roof, height: 10 } } : {}),
  };
}

const CITY_COLORS = ['#8195a0', '#b5ac97', '#6b808d', '#a3b4b7', '#8b7970', '#c0bcae'];
function cityLayout(): ExplorationLayout {
  const roads: UrbanBox[] = DOWNTOWN_STREETS.flatMap(value => [
    { x: value, z: 0, width: DOWNTOWN_ROAD_WIDTH, depth: 4800, base: 2, height: 0.04 },
    { x: 0, z: value, width: 4800, depth: DOWNTOWN_ROAD_WIDTH, base: 2, height: 0.04 },
  ]);
  const buildings: ExplorationSolid[] = [];
  for (let row = 0; row < 10; row++) for (let column = 0; column < 10; column++) {
    const x = -1800 + column * 400, z = -1800 + row * 400;
    // One central block is a plaza; all street-centre routes stay unobstructed.
    if (column === 4 && row === 5) continue;
    for (let lot = 0; lot < 2; lot++) {
      const index = (row * 10 + column) * 2 + lot;
      const centrality = Math.exp(-(x * x + z * z) / 1_600_000);
      buildings.push({ x: x + (lot ? 82 : -82), z: z + ((index * 19) % 41 - 20),
        width: 95 + index % 3 * 9, depth: 150 + index % 4 * 13,
        base: 2, height: 24 + index % 7 * 8 + centrality * (45 + index % 5 * 22),
        color: CITY_COLORS[index % CITY_COLORS.length], variant: index % 5 });
    }
  }
  const boxes: UrbanBox[] = [...buildings];
  for (const building of buildings) {
    const details = buildingRoofDetails(building);
    boxes.push(details.cap, details.hvac);
    if (details.antenna) boxes.push(details.antenna);
  }
  return { buildings, rocks: [], roads, boxes };
}

function naturalLayout(id: 'desert' | 'mountains'): ExplorationLayout {
  const rocks: ExplorationSolid[] = [];
  const count = id === 'desert' ? 100 : 130;
  for (let index = 0; index < count; index++) {
    const x = -2240 + (index * 1547 % 4481), z = -2240 + (index * 2347 % 4481);
    if (Math.abs(x) < 600 && z > -1300 && z < 500) continue;
    const width = (id === 'desert' ? 9 : 5) + index % 7 * 2.2;
    const depth = width * (0.7 + index % 3 * 0.18);
    rocks.push({ x, z, width, depth, base: explorationGroundHeight(id, x, z) - 1,
      height: (id === 'desert' ? 8 : 4) + index % 9 * (id === 'desert' ? 2.6 : 1.1),
      color: id === 'desert' ? ['#b67646', '#cb925a', '#a9663e'][index % 3] : ['#6c7275', '#858582', '#9a9890'][index % 3],
      variant: index % 5 });
  }
  // Natural rocks use conservative cuboid contacts for the faceted visual
  // silhouettes. Their corners and flat support are deliberately approximate;
  // this avoids introducing a second per-frame mesh collider in the flight core.
  const buildings: ExplorationSolid[] = id === 'desert' ? [
    { x: 360, z: -260, width: 12, depth: 9, height: 4.5, color: '#c5aa7d' },
    { x: 387, z: -260, width: 10, depth: 8, height: 3.8, color: '#b79e76' },
    { x: 372, z: -287, width: 9, depth: 11, height: 4.2, color: '#d0b58a' },
  ].map((building, variant) => ({ ...building, base: explorationGroundHeight(id, building.x, building.z), variant })) : [];
  return { buildings, rocks, roads: [], boxes: [...rocks, ...buildings] };
}

const LAYOUTS: Readonly<Record<ExplorationMapId, ExplorationLayout>> = {
  desert: naturalLayout('desert'), downtown: cityLayout(), mountains: naturalLayout('mountains'),
};
export function getExplorationLayout(id: ExplorationMapId): ExplorationLayout { return LAYOUTS[id]; }
