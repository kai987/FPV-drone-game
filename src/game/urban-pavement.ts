import * as THREE from 'three';
import type { RoadRectangle } from './urban-roads.ts';

interface GroundBounds { minX: number; maxX: number; minZ: number; maxZ: number; }
const MAX_CELLS = 262_144;
const GROUND_SPAN = 256;

function rectangleBounds(rect: RoadRectangle): GroundBounds {
  const bounds = { minX: rect.x - rect.width / 2, maxX: rect.x + rect.width / 2,
    minZ: rect.z - rect.depth / 2, maxZ: rect.z + rect.depth / 2 };
  if (![rect.x, rect.z, rect.width, rect.depth, ...Object.values(bounds)].every(Number.isFinite)
    || rect.width <= 0 || rect.depth <= 0 || bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ)
    throw new RangeError('Invalid pavement rectangle');
  return bounds;
}

function segments(length: number, maxSpan: number): number {
  const count = Math.ceil(length / maxSpan);
  if (!Number.isFinite(count) || count < 1 || count > MAX_CELLS) throw new RangeError('Pavement grid is too large');
  return count;
}

/** Subdivide a bounded interval without creating kilometre-long triangles. */
function gridAxis(edges: Set<number>): number[] {
  const cuts = [...edges].sort((a, b) => a - b), result = [cuts[0]];
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1], end = cuts[i], count = segments(end - start, GROUND_SPAN);
    if (result.length + count > MAX_CELLS) throw new RangeError('Pavement grid is too large');
    for (let j = 1; j < count; j++) result.push(start + (end - start) * j / count);
    result.push(end);
  }
  return result;
}

/** World-space ground at y=2, with actual holes beneath every paved road. */
export function createUrbanGroundGeometry(bounds: GroundBounds, roads: readonly RoadRectangle[]): THREE.BufferGeometry {
  if (!Object.values(bounds).every(Number.isFinite) || bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ)
    throw new RangeError('Invalid urban ground bounds');
  const clipped = roads.map(rectangleBounds).map(road => ({
    minX: Math.max(bounds.minX, road.minX), maxX: Math.min(bounds.maxX, road.maxX),
    minZ: Math.max(bounds.minZ, road.minZ), maxZ: Math.min(bounds.maxZ, road.maxZ),
  })).filter(road => road.maxX > road.minX && road.maxZ > road.minZ);
  // Road edges only split the 256m tiles they actually touch. A global grid
  // would propagate every driveway edge across the entire 12km horizon.
  const xTiles = gridAxis(new Set([bounds.minX, bounds.maxX]));
  const zTiles = gridAxis(new Set([bounds.minZ, bounds.maxZ]));
  if ((xTiles.length - 1) * (zTiles.length - 1) > MAX_CELLS) throw new RangeError('Pavement grid is too large');
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  let cells = 0;
  for (let zTile = 1; zTile < zTiles.length; zTile++) {
    const minZ = zTiles[zTile - 1], maxZ = zTiles[zTile];
    const rowRoads = clipped.filter(road => road.minZ < maxZ && road.maxZ > minZ);
    for (let xTile = 1; xTile < xTiles.length; xTile++) {
      const minX = xTiles[xTile - 1], maxX = xTiles[xTile];
      const nearby = rowRoads.filter(road => road.minX < maxX && road.maxX > minX);
      const xs = new Set([minX, maxX]), zs = new Set([minZ, maxZ]);
      for (const road of nearby) {
        xs.add(Math.max(minX, road.minX)); xs.add(Math.min(maxX, road.maxX));
        zs.add(Math.max(minZ, road.minZ)); zs.add(Math.min(maxZ, road.maxZ));
      }
      const xCuts = [...xs].sort((a, b) => a - b), zCuts = [...zs].sort((a, b) => a - b);
      cells += (xCuts.length - 1) * (zCuts.length - 1);
      if (cells > MAX_CELLS) throw new RangeError('Pavement grid is too large');
      for (let x = 1; x < xCuts.length; x++) for (let z = 1; z < zCuts.length; z++) {
        const x0 = xCuts[x - 1], x1 = xCuts[x], z0 = zCuts[z - 1], z1 = zCuts[z];
        if (nearby.some(road => x0 >= road.minX && x1 <= road.maxX && z0 >= road.minZ && z1 <= road.maxZ)) continue;
        const vertex = positions.length / 3;
        positions.push(x0, 2, z0, x1, 2, z0, x0, 2, z1, x1, 2, z1);
        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        indices.push(vertex, vertex + 2, vertex + 1, vertex + 2, vertex + 3, vertex + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** A unit box retains the quay walls and underside, without an overlapping top. */
export function createGroundBodyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1), original = geometry.index!;
  const normal = geometry.getAttribute('normal'), indices: number[] = [];
  for (let i = 0; i < original.count; i += 3) {
    const a = original.getX(i), b = original.getX(i + 1), c = original.getX(i + 2);
    if (normal.getY(a) === 1 && normal.getY(b) === 1 && normal.getY(c) === 1) continue;
    indices.push(a, b, c);
  }
  geometry.clearGroups(); geometry.setIndex(indices);
  return geometry;
}

/** Equal subdivisions share their exact boundaries and preserve the authored area. */
export function splitPavementRectangle(rect: RoadRectangle, maxSpan = 128): RoadRectangle[] {
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) throw new RangeError('Invalid pavement segment span');
  const bounds = rectangleBounds(rect), columns = segments(rect.width, maxSpan), rows = segments(rect.depth, maxSpan);
  if (columns * rows > MAX_CELLS) throw new RangeError('Pavement grid is too large');
  const result: RoadRectangle[] = [];
  for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
    const x0 = bounds.minX + rect.width * column / columns, x1 = column + 1 === columns ? bounds.maxX : bounds.minX + rect.width * (column + 1) / columns;
    const z0 = bounds.minZ + rect.depth * row / rows, z1 = row + 1 === rows ? bounds.maxZ : bounds.minZ + rect.depth * (row + 1) / rows;
    result.push({ x: x0 + (x1 - x0) / 2, z: z0 + (z1 - z0) / 2, width: x1 - x0, depth: z1 - z0 });
  }
  return result;
}
