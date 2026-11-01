import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { splitTerrainGrid, updateDetailVisibility } from '../src/game/scenery-chunks.ts';

test('terrain tiles preserve every original triangle, edge height, UV and shared normal', () => {
  const source = new THREE.PlaneGeometry(160, 120, 8, 6); source.rotateX(-Math.PI / 2);
  const positions = source.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, Math.sin(positions.getX(i) * 0.05) * 30 + Math.cos(positions.getZ(i) * 0.07) * 15);
  source.computeVertexNormals();
  const tiles = splitTerrainGrid(source, 8, 6, 3);
  assert.equal(tiles.length, 6);
  const originals = new Map<string, number>();
  const key = (p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) => `${p.getX(i)}:${p.getZ(i)}`;
  for (let i = 0; i < positions.count; i++) originals.set(key(positions, i), i);
  let duplicatedEdges = 0;
  const seen = new Set<string>();
  for (const tile of tiles) {
    assert.ok(tile.boundingSphere!.radius < 100, 'tiles have independent, local culling bounds');
    for (let i = 0; i < tile.attributes.position.count; i++) {
      const id = key(tile.attributes.position, i), original = originals.get(id)!;
      if (seen.has(id)) duplicatedEdges++;
      seen.add(id);
      for (const name of ['position', 'normal', 'uv']) {
        const a = source.getAttribute(name), b = tile.getAttribute(name);
        for (let axis = 0; axis < a.itemSize; axis++) assert.equal(b.getComponent(i, axis), a.getComponent(original, axis));
      }
    }
  }
  assert.ok(duplicatedEdges > 0, 'adjacent tiles really share identical edge data');
  const triangles = (geometry: THREE.BufferGeometry) => {
    const output: string[] = [], p = geometry.attributes.position, index = geometry.index!;
    for (let i = 0; i < index.count; i += 3) output.push([0, 1, 2].map(corner => key(p, index.getX(i + corner))).join('|'));
    return output;
  };
  assert.deepEqual(tiles.flatMap(triangles).sort(), triangles(source).sort(), 'no triangle is dropped, rewound or changed');
  tiles.forEach(tile => tile.dispose()); source.dispose();
});

test('decorative visibility measures distance to the whole chunk, including nearby edges', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial(), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(300, 0, 0)); mesh.computeBoundingSphere();
  updateDetailVisibility([mesh], { x: 0, y: 0, z: 0 }, 100); assert.equal(mesh.visible, false);
  updateDetailVisibility([mesh], { x: 200, y: 0, z: 0 }, 100); assert.equal(mesh.visible, true);
  updateDetailVisibility([mesh], undefined, 100); assert.equal(mesh.visible, true, 'warmup may prepare every decoration');
  mesh.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
});
