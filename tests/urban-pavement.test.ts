import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGroundBodyGeometry, createUrbanGroundGeometry, splitPavementRectangle } from '../src/game/urban-pavement.ts';
import { getMapLayout } from '../src/game/map-layout.ts';
import type { RoadRectangle } from '../src/game/urban-roads.ts';
import { HARBOR_SHORE_X } from '../src/game/map-layout.ts';
import { urbanWorldFixture } from './helpers/urban-world-fixture.ts';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type Triangle = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];
const EPSILON = 1e-5;

function triangles(geometry: THREE.BufferGeometry): Triangle[] {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  const result: Triangle[] = [];
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    result.push([0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i + offset) : i + offset)) as unknown as Triangle);
  }
  return result;
}

function near(actual: number, expected: number, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

function rectangleBounds(rect: RoadRectangle): Bounds {
  return { minX: rect.x - rect.width / 2, maxX: rect.x + rect.width / 2, minZ: rect.z - rect.depth / 2, maxZ: rect.z + rect.depth / 2 };
}

/** The GPU terrain positions use Float32, including fractional driveway edges. */
function floatRectangle(rect: RoadRectangle): RoadRectangle {
  const b = rectangleBounds(rect);
  const minX = Math.fround(b.minX), maxX = Math.fround(b.maxX);
  const minZ = Math.fround(b.minZ), maxZ = Math.fround(b.maxZ);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ };
}

/** Independent sweep computes the paved union area, including overlaps and clipped ends. */
function roadUnionArea(bounds: Bounds, roads: readonly RoadRectangle[]): number {
  const rectangles = roads.map(rectangleBounds).map(rect => ({
    minX: Math.max(rect.minX, bounds.minX), maxX: Math.min(rect.maxX, bounds.maxX),
    minZ: Math.max(rect.minZ, bounds.minZ), maxZ: Math.min(rect.maxZ, bounds.maxZ),
  })).filter(rect => rect.minX < rect.maxX && rect.minZ < rect.maxZ);
  const xs = [...new Set(rectangles.flatMap(rect => [rect.minX, rect.maxX]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const intervals = rectangles.filter(rect => rect.minX < xs[i] && rect.maxX > xs[i - 1])
      .map(rect => [rect.minZ, rect.maxZ]).sort((a, b) => a[0] - b[0]);
    let end = -Infinity, covered = 0;
    for (const [start, finish] of intervals) { covered += Math.max(0, finish - Math.max(start, end)); end = Math.max(end, finish); }
    area += (xs[i] - xs[i - 1]) * covered;
  }
  return area;
}

/** Separating axes detect any triangle crossing a road interior, not just its centroid. */
function intersectsRoad(triangle: Triangle, road: RoadRectangle): boolean {
  const axes: [number, number][] = [[1, 0], [0, 1]];
  for (let i = 0; i < 3; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3];
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length > 0) axes.push([-dz / length, dx / length]);
  }
  return axes.every(([x, z]) => {
    const values = triangle.map(point => point.x * x + point.z * z);
    const center = road.x * x + road.z * z;
    const radius = road.width / 2 * Math.abs(x) + road.depth / 2 * Math.abs(z);
    return Math.min(...values) < center + radius - EPSILON && Math.max(...values) > center - radius + EPSILON;
  });
}

function geometryArea(geometry: THREE.BufferGeometry): number {
  return triangles(geometry).reduce((area, [a, b, c]) => area + new THREE.Vector3().subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a)).length() / 2, 0);
}

function groundMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('ground triangles leave the exact clipped road union open and retain upward-facing terrain around it', () => {
  const bounds = { minX: -200, maxX: 200, minZ: -300, maxZ: 300 };
  const roads = [
    { x: 0, z: 0, width: 44, depth: 800 },
    { x: 0, z: 0, width: 600, depth: 26 },
    { x: 0, z: 0, width: 44, depth: 800 }, // Repeated layout entries cannot remove extra area.
    { x: 1000, z: 1000, width: 80, depth: 80 },
  ];
  const geometry = createUrbanGroundGeometry(bounds, roads);
  try {
    near(geometryArea(geometry), 204_344);
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) assert.deepEqual([normal.getX(i), normal.getY(i), normal.getZ(i)], [0, 1, 0]);
    for (const triangle of triangles(geometry)) {
      const [a, b, c] = triangle;
      assert.ok(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y > 0);
      assert.ok(triangle.every(point => point.y === 2 && point.x >= bounds.minX && point.x <= bounds.maxX
        && point.z >= bounds.minZ && point.z <= bounds.maxZ));
      assert.ok(roads.every(road => !intersectsRoad(triangle, road)), 'no terrain triangle extends across asphalt');
      assert.ok(Math.max(...triangle.map(point => point.x)) - Math.min(...triangle.map(point => point.x)) <= 256);
      assert.ok(Math.max(...triangle.map(point => point.z)) - Math.min(...triangle.map(point => point.z)) <= 256);
    }
  } finally { geometry.dispose(); }
});

test('terrain remains beside road edges and just beyond road ends without opening gaps into the surrounding ground', () => {
  const geometry = createUrbanGroundGeometry({ minX: -400, maxX: 400, minZ: -600, maxZ: 600 },
    [{ x: 0, z: 0, width: 44, depth: 500 }]);
  const mesh = groundMesh(geometry), ray = new THREE.Raycaster();
  const sample = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(mesh);
  };
  try {
    assert.equal(sample(0, 0).length, 0);
    assert.equal(sample(21.9, 0).length, 0);
    assert.equal(sample(0, 249.9).length, 0);
    for (const [x, z] of [[22.1, 0], [-22.1, 0], [0, 250.1], [0, -250.1], [399, 599], [-399, -599]]) {
      const hit = sample(x, z)[0]; assert.ok(hit, `terrain is missing outside the road at ${x}/${z}`); near(hit.point.y, 2);
    }
  } finally { geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
});

test('the structural body retains four quay walls and the underside while omitting every upward face', () => {
  const geometry = createGroundBodyGeometry(), mesh = groundMesh(geometry);
  try {
    const faces = triangles(geometry);
    assert.equal(faces.length, 10);
    assert.equal(geometry.groups.length, 0, 'removed faces cannot leave stale material-group ranges');
    const directions = new Set(faces.map(([a, b, c]) => {
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      assert.ok(normal.y <= 0, 'the old 12km ground top would still compete with roads');
      return normal.toArray().map(value => Math.round(value)).join(',');
    }));
    assert.deepEqual(directions, new Set(['1,0,0', '-1,0,0', '0,-1,0', '0,0,1', '0,0,-1']));
    mesh.position.set(HARBOR_SHORE_X - 6000, -3, -700); mesh.scale.set(12000, 10, 12000); mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(200, 0, -500), new THREE.Vector3(-1, 0, 0));
    const wall = ray.intersectObject(mesh)[0]; assert.ok(wall); near(wall.point.x, HARBOR_SHORE_X); near(wall.point.y, 0);
    ray.set(new THREE.Vector3(0, -20, -500), new THREE.Vector3(0, 1, 0));
    const underside = ray.intersectObject(mesh)[0]; assert.ok(underside); near(underside.point.y, -8);
    ray.set(new THREE.Vector3(0, 100, -500), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(mesh).length, 0, 'the road opening does not expose a second body top');
  } finally { geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
});

test('pavement subdivisions cover the authored rectangle once with shared endpoints and bounded dimensions', () => {
  for (const rect of [
    { x: 0, z: -700, width: 44, depth: 6400 },
    { x: 0, z: -3200, width: 6400, depth: 26 },
    { x: -1550, z: 1400, width: 3340, depth: 26 },
    { x: 15.3, z: -21.7, width: 257.2, depth: 389.4 },
    { x: 0, z: 0, width: 0.13, depth: 9 },
  ]) {
    const segments = splitPavementRectangle(rect), bounds = rectangleBounds(rect);
    near(segments.reduce((sum, part) => sum + part.width * part.depth, 0), rect.width * rect.depth, 1e-6);
    for (const [i, part] of segments.entries()) {
      assert.ok(part.width > 0 && part.depth > 0 && part.width <= 128 + EPSILON && part.depth <= 128 + EPSILON);
      const box = rectangleBounds(part);
      assert.ok(box.minX >= bounds.minX - EPSILON && box.maxX <= bounds.maxX + EPSILON
        && box.minZ >= bounds.minZ - EPSILON && box.maxZ <= bounds.maxZ + EPSILON);
      for (const other of segments.slice(i + 1)) assert.ok(Math.abs(part.x - other.x) >= (part.width + other.width) / 2 - EPSILON
        || Math.abs(part.z - other.z) >= (part.depth + other.depth) / 2 - EPSILON, 'pavement segments overlap');
    }
    const boxes = segments.map(rectangleBounds);
    near(Math.min(...boxes.map(box => box.minX)), bounds.minX); near(Math.max(...boxes.map(box => box.maxX)), bounds.maxX);
    near(Math.min(...boxes.map(box => box.minZ)), bounds.minZ); near(Math.max(...boxes.map(box => box.maxZ)), bounds.maxZ);
    const custom = splitPavementRectangle(rect, 64);
    assert.ok(custom.every(part => part.width <= 64 + EPSILON && part.depth <= 64 + EPSILON));
    near(custom.reduce((sum, part) => sum + part.width * part.depth, 0), rect.width * rect.depth, 1e-6);
  }
});

test('invalid and excessive tessellation is rejected before creating unbounded geometry', () => {
  for (const bounds of [
    { minX: 0, maxX: 0, minZ: -1, maxZ: 1 },
    { minX: 1, maxX: -1, minZ: -1, maxZ: 1 },
    { minX: NaN, maxX: 1, minZ: -1, maxZ: 1 },
    { minX: -1, maxX: 1, minZ: -Infinity, maxZ: 1 },
    { minX: -1e12, maxX: 1e12, minZ: -1e12, maxZ: 1e12 },
  ]) assert.throws(() => createUrbanGroundGeometry(bounds, []), RangeError);
  const rect = { x: 0, z: 0, width: 44, depth: 6400 };
  for (const span of [0, -1, NaN, Infinity, 1e-12]) assert.throws(() => splitPavementRectangle(rect, span), RangeError);
  for (const invalid of [{ ...rect, width: 0 }, { ...rect, depth: -1 }, { ...rect, x: NaN }]) {
    assert.throws(() => splitPavementRectangle(invalid), RangeError);
    assert.throws(() => createUrbanGroundGeometry({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [invalid]), RangeError);
  }
});

test('hundreds of distinct driveway edges split local tiles without a map-wide Cartesian grid', () => {
  const bounds = { minX: -6000, maxX: 6000, minZ: -6000, maxZ: 6000 };
  const roads = Array.from({ length: 315 }, (_, index) => ({
    x: -5500 + index * 97 % 11000, z: -5500 + index * 131 % 11000, width: 12, depth: 32,
  }));
  const geometry = createUrbanGroundGeometry(bounds, roads), mesh = groundMesh(geometry);
  try {
    near(geometryArea(geometry), 144_000_000 - roadUnionArea(bounds, roads), 0.01);
    assert.ok(geometry.index!.count / 3 < 32_000, 'driveway boundaries remain local to their terrain tiles');
    for (const road of roads) {
      const ray = new THREE.Raycaster(new THREE.Vector3(road.x, 100, road.z), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObject(mesh).length, 0, 'every driveway opens the terrain beneath it');
    }
  } finally { geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
});

for (const mapId of ['factory', 'harbor'] as const) {
  test(`${mapId} real horizon terrain contains the exact road cutouts with bounded geometry`, () => {
    const bounds = { minX: mapId === 'harbor' ? HARBOR_SHORE_X - 12000 : -6000,
      maxX: mapId === 'harbor' ? HARBOR_SHORE_X : 6000, minZ: -6700, maxZ: 5300 };
    const roads = getMapLayout(mapId).roads.surfaces, geometry = createUrbanGroundGeometry(bounds, roads);
    try {
      const gpuRoads = roads.map(floatRectangle);
      const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ) - roadUnionArea(bounds, gpuRoads);
      near(geometryArea(geometry), area, 0.01);
      near(geometry.boundingBox!.min.x, bounds.minX); near(geometry.boundingBox!.max.x, bounds.maxX);
      near(geometry.boundingBox!.min.z, bounds.minZ); near(geometry.boundingBox!.max.z, bounds.maxZ);
      const faces = triangles(geometry);
      assert.ok(faces.length < 24_000, 'main roads and driveways remain within a bounded local terrain mesh');
      const bytes = geometry.getAttribute('position').array.byteLength + geometry.getAttribute('normal').array.byteLength + geometry.index!.array.byteLength;
      assert.ok(bytes < 1024 * 1024, 'one full 12km ground surface stays below 1MiB of geometry buffers');
      for (const face of faces) {
        assert.ok(gpuRoads.every(road => !intersectsRoad(face, road)), 'a ground triangle spans a GPU road interior');
        assert.ok(Math.max(...face.map(point => point.x)) - Math.min(...face.map(point => point.x)) <= 256.001);
        assert.ok(Math.max(...face.map(point => point.z)) - Math.min(...face.map(point => point.z)) <= 256.001);
      }
      assert.ok(roads.reduce((count, road) => count + splitPavementRectangle(road).length, 0) < 3000);
    } finally { geometry.dispose(); }
  });

  test(`${mapId} rendered roads at 93m and 450m remain visible and have no competing ground surface in top-down or oblique cameras`, () => {
    const { scenery, dispose } = urbanWorldFixture(mapId);
    try {
      const ground = scenery.scene.getObjectByName('Industrial ground surface');
      assert.ok(ground instanceof THREE.InstancedMesh);
      const asphalt: THREE.InstancedMesh[] = [];
      const bodies: THREE.InstancedMesh[] = [];
      scenery.scene.traverse(object => {
        if (object instanceof THREE.InstancedMesh && object.geometry.index?.count === 30) bodies.push(object);
        if (object instanceof THREE.InstancedMesh && !Array.isArray(object.material)
          && object.material instanceof THREE.MeshStandardMaterial
          && object.material.color.getHexString() === (mapId === 'factory' ? '545957' : '515b5b')) asphalt.push(object);
      });
      assert.ok(asphalt.length > 0);
      assert.equal(bodies.length, 1, 'the rendered structural ground uses its open-top body geometry');
      if (mapId === 'harbor') {
        const coast = new THREE.Raycaster(new THREE.Vector3(200, 0, -500), new THREE.Vector3(-1, 0, 0));
        const wall = coast.intersectObjects(bodies)[0];
        assert.ok(wall, 'cutting the terrain top must not remove the actual harbor quay wall');
        near(wall.point.x, HARBOR_SHORE_X); near(wall.point.y, 0);
      }
      const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
      for (const mesh of asphalt) {
        assert.notEqual(mesh.name, 'Industrial surface details', 'major roads cannot disappear through detail LOD');
        assert.ok(mesh.material instanceof THREE.MeshStandardMaterial && mesh.material.polygonOffset);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
          assert.ok(scale.x <= 128.001 && scale.z <= 128.001, 'road faces are locally subdivided');
        }
      }
      for (const height of [93, 450]) for (const view of ['top', 'chase', 'oblique']) {
        const camera = new THREE.PerspectiveCamera(68, 1280 / 620, 0.2, 10000);
        const target = new THREE.Vector3(0, 2.0225, -500);
        if (view === 'top') { camera.position.set(0, height, -500); camera.up.set(0, 0, -1); camera.lookAt(target); }
        else {
          const x = view === 'oblique' ? 200 : 0;
          camera.position.set(x, height + 3.3, 63); camera.lookAt(x, height + 0.8, 50);
        }
        camera.updateMatrixWorld();
        scenery.update(0, 0, { x: 0, y: height, z: 55 }, camera.position); scenery.scene.updateMatrixWorld(true);
        const screen = target.clone().project(camera);
        assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1, 'the reproduced road sample is inside the camera');
        const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
        const pavementHit = ray.intersectObjects(asphalt, false)[0];
        assert.ok(pavementHit, `${mapId} road vanishes at ${height}m/${view}`); near(pavementHit.point.y, 2.0225);
        assert.equal(ray.intersectObject(ground, false).length, 0, 'the same pixel cannot also rasterize a ground top beneath the road');
        const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        assert.ok(asphalt.every(mesh => mesh.visible && frustum.intersectsObject(mesh)), 'road batches retain correct frustum bounds');
      }
      const direct = new THREE.Raycaster(new THREE.Vector3(0, 100, -100), new THREE.Vector3(0, -1, 0));
      assert.equal(direct.intersectObject(ground).length, 0);
      near(direct.intersectObjects(asphalt)[0].point.y, 2.0225);
      direct.set(new THREE.Vector3(40, 100, -100), new THREE.Vector3(0, -1, 0));
      near(direct.intersectObject(ground)[0].point.y, 2);
      const resources = new Set<THREE.BufferGeometry>([ground.geometry, ...asphalt.map(mesh => mesh.geometry), ...bodies.map(mesh => mesh.geometry)]);
      const disposed = new Map([...resources].map(geometry => [geometry, 0]));
      for (const geometry of resources) geometry.addEventListener('dispose', () => disposed.set(geometry, disposed.get(geometry)! + 1));
      dispose(); dispose();
      assert.ok([...disposed.values()].every(count => count === 1), 'new ground and segmented roads keep single-owner resource cleanup');
    } finally { dispose(); }
  });
}
