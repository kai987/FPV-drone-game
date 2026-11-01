import * as THREE from 'three';
import type { Vec3 } from './flight.ts';

/** Structures keep their full silhouette; small decorations use finer regional batches. */
export function sceneryChunkKey(x: number, z: number, detail = false): string {
  const size = detail ? 600 : 1200;
  return `${Math.floor(x / size)}:${Math.floor(z / size)}`;
}

export function updateDetailVisibility(chunks: readonly THREE.InstancedMesh[], position: Vec3 | undefined, distance: number): void {
  for (const chunk of chunks) {
    const sphere = chunk.boundingSphere;
    if (!position || !sphere) { chunk.visible = true; continue; }
    const dx = position.x - sphere.center.x, dy = position.y - sphere.center.y, dz = position.z - sphere.center.z;
    chunk.visible = dx * dx + dy * dy + dz * dz <= (sphere.radius + distance) ** 2;
  }
}

/**
 * Split an already sampled plane after its normals are calculated. Shared edge
 * positions, normals, UVs and triangle winding are copied without resampling the
 * physical terrain or averaging each tile's edges independently.
 */
export function splitTerrainGrid(source: THREE.BufferGeometry, segmentsX: number, segmentsZ: number, tileCells = 96): THREE.BufferGeometry[] {
  if (!Number.isInteger(segmentsX) || !Number.isInteger(segmentsZ) || segmentsX < 1 || segmentsZ < 1
    || !Number.isInteger(tileCells) || tileCells < 1 || !source.index
    || source.getAttribute('position').count !== (segmentsX + 1) * (segmentsZ + 1)) {
    throw new RangeError('A complete indexed terrain grid is required');
  }
  const tiles: THREE.BufferGeometry[] = [];
  for (let row = 0; row < segmentsZ; row += tileCells) for (let column = 0; column < segmentsX; column += tileCells) {
    const width = Math.min(tileCells, segmentsX - column), depth = Math.min(tileCells, segmentsZ - row);
    const tile = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const values = new Float32Array((width + 1) * (depth + 1) * attribute.itemSize);
      for (let z = 0; z <= depth; z++) for (let x = 0; x <= width; x++) {
        const input = (row + z) * (segmentsX + 1) + column + x;
        const output = (z * (width + 1) + x) * attribute.itemSize;
        for (let component = 0; component < attribute.itemSize; component++) values[output + component] = attribute.getComponent(input, component);
      }
      tile.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
    }
    const indices: number[] = [];
    for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
      const input = ((row + z) * segmentsX + column + x) * 6;
      for (let corner = 0; corner < 6; corner++) {
        const original = source.index.getX(input + corner);
        indices.push((Math.floor(original / (segmentsX + 1)) - row) * (width + 1) + original % (segmentsX + 1) - column);
      }
    }
    tile.setIndex(indices); tile.computeBoundingSphere();
    tile.userData.terrainTile = { column, row, width, depth, segmentsX, segmentsZ };
    tiles.push(tile);
  }
  return tiles;
}
