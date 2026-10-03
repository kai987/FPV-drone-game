import type { Vec3 } from './flight.ts';

export const WORLD_BOUNDS = Object.freeze({ minX: -1800, maxX: 1800, minZ: -2500, maxZ: 1100, maxAltitude: 450 });
export const TERRAIN_SIZE = 4200;
export const WORLD_CENTER_Z = -700;
export const WATER_LEVEL = -2;

export interface Lake {
  id: string;
  name: string;
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  rotation: number;
}

export const LAKES: readonly Lake[] = Object.freeze([
  { id: 'main-lake', name: '翡翠湖', x: -470, z: -780, radiusX: 360, radiusZ: 280, rotation: 0.18 },
  { id: 'upper-lake', name: '松影湖', x: 760, z: -1660, radiusX: 200, radiusZ: 150, rotation: -0.32 },
]);

export const RIVER_POINTS: readonly Vec3[] = Object.freeze([
  { x: 480, y: WATER_LEVEL, z: -2800 },
  { x: 340, y: WATER_LEVEL, z: -2050 },
  { x: 650, y: WATER_LEVEL, z: -1710 },
  { x: 550, y: WATER_LEVEL, z: -1600 },
  { x: 140, y: WATER_LEVEL, z: -1200 },
  { x: -470, y: WATER_LEVEL, z: -780 },
  { x: 160, y: WATER_LEVEL, z: -440 },
  { x: 220, y: WATER_LEVEL, z: -230 },
  { x: 85, y: WATER_LEVEL, z: -60 },
  { x: 200, y: WATER_LEVEL, z: 220 },
  { x: 100, y: WATER_LEVEL, z: 650 },
  { x: 350, y: WATER_LEVEL, z: 1400 },
]);

export interface RiverSample {
  x: number;
  z: number;
  halfWidth: number;
}

/** The channel half-width varies gently rather than forming a constant ribbon. */
export function riverWidth(z: number): number {
  return 18 + 7 * (0.5 + 0.5 * Math.sin(z * 0.0033 + 0.8))
    + 5 * (0.5 + 0.5 * Math.sin(z * 0.0071 - 0.5));
}

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
    + (-a + 3 * b - 3 * c + d) * t * t * t);
}

function sampleRiver(): RiverSample[] {
  const result: RiverSample[] = [];
  for (let section = 0; section < RIVER_POINTS.length - 1; section++) {
    const b = RIVER_POINTS[section];
    const c = RIVER_POINTS[section + 1];
    const a = RIVER_POINTS[section - 1] ?? { x: 2 * b.x - c.x, z: 2 * b.z - c.z };
    const d = RIVER_POINTS[section + 2] ?? { x: 2 * c.x - b.x, z: 2 * c.z - b.z };
    for (let sample = 0; sample < 32; sample++) {
      const t = sample / 32;
      const x = catmull(a.x, b.x, c.x, d.x, t);
      const z = catmull(a.z, b.z, c.z, d.z, t);
      result.push({ x, z, halfWidth: riverWidth(z) });
    }
  }
  const end = RIVER_POINTS[RIVER_POINTS.length - 1];
  result.push({ x: end.x, z: end.z, halfWidth: riverWidth(end.z) });
  return result;
}

/** Renderer and minimap share this smooth channel centreline. */
export const RIVER_SAMPLES: readonly RiverSample[] = Object.freeze(sampleRiver());

interface Segment {
  ax: number; az: number; bx: number; bz: number;
  lengthSquared: number; widthA: number; widthB: number;
}

interface RiverNode {
  minX: number; maxX: number; minZ: number; maxZ: number; maxWidth: number;
  segments?: Segment[];
  left?: RiverNode;
  right?: RiverNode;
}

function buildRiverTree(segments: Segment[]): RiverNode {
  const node: RiverNode = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxWidth: 0 };
  for (const segment of segments) {
    node.minX = Math.min(node.minX, segment.ax, segment.bx);
    node.maxX = Math.max(node.maxX, segment.ax, segment.bx);
    node.minZ = Math.min(node.minZ, segment.az, segment.bz);
    node.maxZ = Math.max(node.maxZ, segment.az, segment.bz);
    node.maxWidth = Math.max(node.maxWidth, segment.widthA, segment.widthB);
  }
  if (segments.length <= 8) node.segments = segments;
  else {
    const sortX = node.maxX - node.minX > node.maxZ - node.minZ;
    segments.sort((a, b) => sortX ? (a.ax + a.bx) - (b.ax + b.bx) : (a.az + a.bz) - (b.az + b.bz));
    const middle = Math.floor(segments.length / 2);
    node.left = buildRiverTree(segments.slice(0, middle));
    node.right = buildRiverTree(segments.slice(middle));
  }
  return node;
}

const riverTree = buildRiverTree(RIVER_SAMPLES.slice(0, -1).map((a, index) => {
  const b = RIVER_SAMPLES[index + 1];
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z, lengthSquared: (b.x - a.x) ** 2 + (b.z - a.z) ** 2,
    widthA: a.halfWidth, widthB: b.halfWidth };
}));

function riverDistance(x: number, z: number): number {
  let best = Infinity;
  const lowerBound = (node: RiverNode) => Math.hypot(Math.max(node.minX - x, 0, x - node.maxX),
    Math.max(node.minZ - z, 0, z - node.maxZ)) - node.maxWidth;
  const search = (node: RiverNode) => {
    if (lowerBound(node) >= best) return;
    if (node.segments) {
      for (const segment of node.segments) {
        const t = Math.min(1, Math.max(0, ((x - segment.ax) * (segment.bx - segment.ax)
          + (z - segment.az) * (segment.bz - segment.az)) / segment.lengthSquared));
        const distance = Math.hypot(x - segment.ax - t * (segment.bx - segment.ax),
          z - segment.az - t * (segment.bz - segment.az)) - (segment.widthA + t * (segment.widthB - segment.widthA));
        if (distance < best) best = distance;
      }
    } else {
      const left = node.left!;
      const right = node.right!;
      if (lowerBound(left) < lowerBound(right)) { search(left); search(right); }
      else { search(right); search(left); }
    }
  };
  search(riverTree);
  return best;
}

function lakeShape(lake: Lake, angle: number): number {
  const phase = lake.id === 'main-lake' ? 0.6 : -0.7;
  return 1 + 0.075 * Math.sin(angle * 3 + phase) + 0.045 * Math.cos(angle * 5 - phase * 0.3)
    + 0.025 * Math.sin(angle * 8 + 0.4);
}

function lakeDistance(lake: Lake, x: number, z: number): number {
  const dx = x - lake.x;
  const dz = z - lake.z;
  const cosine = Math.cos(lake.rotation);
  const sine = Math.sin(lake.rotation);
  const u = (dx * cosine + dz * sine) / lake.radiusX;
  const v = (-dx * sine + dz * cosine) / lake.radiusZ;
  const angle = Math.atan2(v, u);
  const normalizedRadius = Math.hypot(u, v);
  // Fade angular variations deep inside the lake. An unfaded polar formula
  // would give several different bed heights at the same lake-centre point.
  const angularBlend = smoothstep(0.15, 0.65, normalizedRadius);
  const shape = 1 + (lakeShape(lake, angle) - 1) * angularBlend;
  const radialScale = Math.min(lake.radiusX, lake.radiusZ)
    + (Math.hypot(lake.radiusX * Math.cos(angle), lake.radiusZ * Math.sin(angle))
      - Math.min(lake.radiusX, lake.radiusZ)) * angularBlend;
  // A signed radial distance: inexpensive, continuous, and exactly matches the
  // irregular contour used by lakeBoundary rather than a perfect ellipse.
  return (normalizedRadius - shape) * radialScale;
}

/** Closed contour without repeating its first point. All vertices lie at water level. */
export function lakeBoundary(lake: Lake, segments = 96): Vec3[] {
  const count = Math.max(12, Math.floor(Number.isFinite(segments) ? segments : 96));
  const cosine = Math.cos(lake.rotation);
  const sine = Math.sin(lake.rotation);
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const shape = lakeShape(lake, angle);
    const x = Math.cos(angle) * lake.radiusX * shape;
    const z = Math.sin(angle) * lake.radiusZ * shape;
    return { x: lake.x + x * cosine - z * sine, y: WATER_LEVEL, z: lake.z + x * sine + z * cosine };
  });
}

/** Signed distance to the connected channel/lake union, negative inside water. */
export function waterDistance(x: number, z: number): number {
  return Math.min(riverDistance(x, z), lakeDistance(LAKES[0], x, z), lakeDistance(LAKES[1], x, z));
}

export function isWater(x: number, z: number): boolean {
  return waterDistance(x, z) < 0;
}

function gaussian(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  return Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
}

/** Smooth ridges surround a low flight valley; banks meet the water continuously. */
export function groundHeight(x: number, z: number): number {
  const warpedX = x + Math.sin(z * 0.0028) * 90;
  const warpedZ = z + Math.sin(x * 0.0031) * 70;
  const rolling = 22 + Math.sin(x * 0.0031 + Math.sin(z * 0.0024)) * 10
    + Math.sin(z * 0.0046 - x * 0.0018) * 6 + Math.sin((x + z) * 0.009) * 2;
  const ridges = gaussian(warpedX, warpedZ, -1250, -1530, 620, 700) * 210
    + gaussian(warpedX, warpedZ, 1250, -850, 580, 900) * 245
    + gaussian(warpedX, warpedZ, -1050, 550, 650, 550) * 170
    + gaussian(warpedX, warpedZ, 700, -2350, 650, 500) * 190;
  const lowValley = 1.1 + Math.sin(x * 0.012) * Math.cos(z * 0.01) * 0.65 + Math.sin((x + z) * 0.015) * 0.45;
  const valleyDistance = Math.hypot((x - 10) / 310, (z + 210) / 420);
  const valleyBlend = smoothstep(0.7, 1.55, valleyDistance);
  const dryTerrain = lowValley + (rolling + ridges - lowValley) * valleyBlend;
  const distance = waterDistance(x, z);
  if (distance < 0) {
    const inland = -distance;
    const depth = Math.min(18, 0.9 * smoothstep(0, 8, inland) + 0.035 * inland * smoothstep(0, 40, inland));
    return WATER_LEVEL - depth;
  }
  return WATER_LEVEL + (Math.max(WATER_LEVEL + 0.02, dryTerrain) - WATER_LEVEL) * smoothstep(0, 80, distance);
}

/** Drones and game projectiles contact the water surface instead of its bed. */
export function surfaceHeight(x: number, z: number): number {
  const ground = groundHeight(x, z);
  return ground < WATER_LEVEL && isWater(x, z) ? WATER_LEVEL : ground;
}
