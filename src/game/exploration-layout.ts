import type { UrbanBox } from './map-layout.ts';
import { getDowntownBuildingParts, getDowntownRoofDetails } from './downtown-architecture.ts';
import { ALPINE_MASSIFS } from './alpine-massifs.ts';

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
  { x: -1250, z: -1050, height: 665, radiusX: 470, radiusZ: 510 },
  { x: 1050, z: -1450, height: 738, radiusX: 455, radiusZ: 435 },
  { x: 1550, z: 650, height: 590, radiusX: 505, radiusZ: 470 },
  { x: -1500, z: 1050, height: 570, radiusX: 490, radiusZ: 475 },
  { x: 50, z: -2250, height: 625, radiusX: 450, radiusZ: 390 },
]);
/** Linked, narrow ridgelines create saddles between the peaks, leaving the training valley open. */
export const MOUNTAIN_RIDGES = Object.freeze([
  { ax: -1250, az: -1050, bx: -1500, bz: 1050, width: 250, height: 300 },
  { ax: -1250, az: -1050, bx: 50, bz: -2250, width: 245, height: 320 },
  { ax: 50, az: -2250, bx: 1050, bz: -1450, width: 230, height: 340 },
  { ax: 1050, az: -1450, bx: 1550, bz: 650, width: 255, height: 320 },
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

function alpineHash(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}
function alpineNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = alpineHash(ix, iz, seed), b = alpineHash(ix + 1, iz, seed);
  const c = alpineHash(ix, iz + 1, seed), d = alpineHash(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v;
}

// Compile the authored crest chains once. A folded massif has several displaced
// high points and unequal shoulders instead of a radius around one cone apex.
const ALPINE_FOLDS = ALPINE_MASSIFS.map(massif => {
  const nodes = massif.crests.flat(), padding = Math.max(...nodes.flatMap(node => [node[3], node[4]])) * 1.12 + 20;
  return { ...massif, minX: Math.min(...nodes.map(node => node[0])) - padding,
    maxX: Math.max(...nodes.map(node => node[0])) + padding,
    minZ: Math.min(...nodes.map(node => node[1])) - padding, maxZ: Math.max(...nodes.map(node => node[1])) + padding,
    segments: massif.crests.flatMap(crest => crest.slice(1).map((b, i) => {
      const a = crest[i], dx = b[0] - a[0], dz = b[1] - a[1], lengthSquared = dx * dx + dz * dz;
      return { a, b, dx, dz, lengthSquared, length: Math.sqrt(lengthSquared) };
    })) };
});
function alpineMassHeight(x: number, z: number): number {
  let height = 0;
  for (let index = 0; index < ALPINE_FOLDS.length; index++) {
    const fold = ALPINE_FOLDS[index];
    if (x < fold.minX || x > fold.maxX || z < fold.minZ || z > fold.maxZ) continue;
    const coarse = alpineNoise(x / 155, z / 155, index + 11);
    const fracture = (alpineNoise(x / 95, z / 95, index + 37) - 0.5) * 0.12
      + (alpineNoise(x / 42, z / 42, index + 71) - 0.5) * 0.04;
    let mass = 0;
    for (const segment of fold.segments) {
      const { a, b, dx, dz, lengthSquared, length } = segment;
      const px = x - a[0], pz = z - a[1];
      const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / lengthSquared));
      const bend = 4 * t * (1 - t) * (coarse - 0.5) * 38;
      const distance = Math.hypot(px - dx * t + dz / length * bend, pz - dz * t - dx / length * bend);
      const signedNormal = (dx * pz - dz * px) / length - bend;
      // Smoothly join unequal shoulders across the bent crest and around its
      // end caps: choosing a width by a hard side sign creates height jumps.
      const direction = Math.max(0, Math.min(1, 0.5 + 0.5 * signedNormal / Math.max(distance, 32)));
      const blend = direction * direction * (3 - 2 * direction);
      const left = a[3] + (b[3] - a[3]) * t, right = a[4] + (b[4] - a[4]) * t;
      const width = (right + (left - right) * blend) * (0.88 + coarse * 0.24);
      const r = distance / width;
      if (r >= 1) continue;
      const inner = 0.16 + coarse * 0.04, outer = 0.58 + coarse * 0.04;
      let profile: number;
      if (r < inner) profile = 1 - 0.12 * r / inner;
      else if (r < outer) {
        const t = (r - inner) / (outer - inner), eased = t * 0.45 + t * t * (3 - 2 * t) * 0.55;
        profile = 0.88 - eased * 0.62;
      } else profile = 0.26 * ((1 - r) / (1 - outer)) ** 1.6;
      const crest = a[2] + (b[2] - a[2]) * t;
      const brokenCrest = crest + 4 * t * (1 - t) * (coarse - 0.5) * 36;
      // A continuous cliff band gives way to a lower scree apron. Its transition
      // spans dozens of metres, remaining representable by the terrain mesh.
      mass = Math.max(mass, brokenCrest * profile + crest * 4 * profile * (1 - profile) * fracture);
    }
    // Off-axis glacial bowls cut headwalls and hanging shoulders into the folds;
    // neither the outline nor the erosion is symmetric about a single summit.
    for (const [cx, cz, rx, rz, depth] of fold.cirques) {
      const u = (x - cx) / rx, v = (z - cz) / rz;
      const bowl = Math.max(0, 1 - u * u - v * v);
      mass -= depth * bowl ** 1.4;
    }
    height = Math.max(height, mass);
  }
  for (let index = 0; index < MOUNTAIN_RIDGES.length; index++) {
    const ridge = MOUNTAIN_RIDGES[index];
    const dx = ridge.bx - ridge.ax, dz = ridge.bz - ridge.az;
    const length = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - ridge.ax) * dx + (z - ridge.az) * dz) / (length * length)));
    const envelope = Math.sin(t * Math.PI), phase = index * 1.9;
    const bend = envelope * (Math.sin(t * 5.3 + phase) * 65 + Math.sin(t * 13.1 - phase) * 24);
    const centerX = ridge.ax + t * dx - dz / length * bend;
    const centerZ = ridge.az + t * dz + dx / length * bend;
    const distance = Math.hypot(x - centerX, z - centerZ);
    const width = ridge.width * (1 + envelope * (0.18 * Math.sin(t * 11 + phase) + 0.1 * Math.sin(t * 23 - phase)));
    // Curved, eroded shoulders avoid a single long triangular wall face.
    const profile = Math.exp(-((distance / width) ** 1.6) * 2.2);
    const crest = 0.57 + envelope * (0.19 + 0.2 * Math.sin(t * 18 + phase)
      + 0.11 * Math.sin(t * 39 + phase * 1.7) + 0.05 * Math.sin(t * 71 - phase));
    let ridgeMass = ridge.height * profile * crest;
    if (profile > 0.025) {
      const flank = 4 * profile * (1 - profile);
      ridgeMass += ridge.height * flank * (0.19 * (alpineNoise(x / 130, z / 130, index + 107) - 0.5)
        + 0.08 * (alpineNoise(x / 55, z / 55, index + 131) - 0.5));
    }
    height = Math.max(height, ridgeMass);
  }
  return height;
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
  return foothills + alpineMassHeight(x, z);
}

/** One metre-scaled source for the rendered roof solids and native contacts. */
export function buildingRoofDetails(building: UrbanBox): BuildingRoofDetails {
  return getDowntownRoofDetails(building);
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
        color: CITY_COLORS[index % CITY_COLORS.length], variant: index % 7 });
    }
  }
  const boxes = buildings.flatMap(building => getDowntownBuildingParts(building).solids);
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
