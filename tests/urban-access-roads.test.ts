import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getMapLayout, HARBOR_SHORE_X } from '../src/game/map-layout.ts';
import type { UrbanBox } from '../src/game/map-layout.ts';
import { MAPS, getMapSpec } from '../src/game/map-catalog.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import type { RoadRectangle } from '../src/game/urban-roads.ts';
import { flightModule, urbanWorldFixture } from './helpers/urban-world-fixture.ts';

interface Point { x: number; z: number; }
const EPSILON = 1e-6;
const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) <= EPSILON, message ?? `${actual} differs from ${expected}`);

function containsPoint(rect: RoadRectangle, point: Point): boolean {
  return Math.abs(point.x - rect.x) <= rect.width / 2 + EPSILON
    && Math.abs(point.z - rect.z) <= rect.depth / 2 + EPSILON;
}

function containsRect(rect: RoadRectangle, other: RoadRectangle): boolean {
  return Math.abs(other.x - rect.x) + other.width / 2 <= rect.width / 2 + EPSILON
    && Math.abs(other.z - rect.z) + other.depth / 2 <= rect.depth / 2 + EPSILON;
}

function overlaps(a: RoadRectangle, b: RoadRectangle): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 - EPSILON
    && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - EPSILON;
}

function overlapsSolid(rect: RoadRectangle, box: UrbanBox): boolean {
  const c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0);
  const dx = box.x - rect.x, dz = box.z - rect.z;
  return [[1, 0], [0, 1], [c, -s], [s, c]].every(([ax, az]) => Math.abs(dx * ax + dz * az)
    < rect.width / 2 * Math.abs(ax) + rect.depth / 2 * Math.abs(az)
      + box.width / 2 * Math.abs(c * ax - s * az) + box.depth / 2 * Math.abs(s * ax + c * az) - EPSILON);
}

function vehicleConnection(a: RoadRectangle, b: RoadRectangle): boolean {
  const x = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
  const z = Math.min(a.z + a.depth / 2, b.z + b.depth / 2) - Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
  // Shared boundaries count, but a point/corner touch cannot carry a truck.
  return x >= -EPSILON && z >= 3 - EPSILON || z >= -EPSILON && x >= 3 - EPSILON;
}

function connectedRoads(surfaces: readonly RoadRectangle[], start: Point): Set<number> {
  const reached = new Set<number>(), queue: number[] = [];
  surfaces.forEach((surface, index) => { if (containsPoint(surface, start)) { reached.add(index); queue.push(index); } });
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const active = surfaces[queue[cursor]];
    surfaces.forEach((surface, index) => {
      if (!reached.has(index) && vehicleConnection(active, surface)) { reached.add(index); queue.push(index); }
    });
  }
  return reached;
}

for (const mapId of ['factory', 'harbor'] as const) {
  test(`${mapId} every loading entrance reaches the same truck-wide road component as the spawn avenue`, () => {
    const layout = getMapLayout(mapId), roads = layout.roads;
    assert.equal(layout.warehouses.length, mapId === 'factory' ? 190 : 125);
    assert.equal(layout.accesses.length, layout.warehouses.length, 'every warehouse has an authored loading entrance');
    assert.equal(new Set(layout.accesses.map(access => access.buildingIndex)).size, layout.warehouses.length);
    const connected = connectedRoads(roads.surfaces, getMapSpec(mapId).spawn);
    assert.equal(connected.size, roads.surfaces.length, 'isolated private drives do not count as connected access');
    for (const access of layout.accesses) {
      const building = layout.warehouses[access.buildingIndex];
      assert.ok(building, 'access references a real warehouse');
      assert.equal(access.label, building.label);
      // These positions are derived independently from the rendered two doors
      // on each facade, rather than accepting a nearby wall as an entrance.
      const c = Math.cos(building.yaw ?? 0), s = Math.sin(building.yaw ?? 0);
      const dx = access.door.x - building.x, dz = access.door.z - building.z;
      const localX = dx * c - dz * s, localZ = dx * s + dz * c;
      near(Math.abs(localX), building.width * 0.28, `${building.label} access connects a rendered door`);
      near(Math.abs(localZ), building.depth / 2, `${building.label} door belongs to a facade`);
      const entryX = (access.entry.x - building.x) * c - (access.entry.z - building.z) * s;
      const entryZ = (access.entry.x - building.x) * s + (access.entry.z - building.z) * c;
      near(entryX, localX, 'entry follows the door normal');
      near(Math.abs(entryZ) - building.depth / 2, 3.1, 'drive reaches the edge of the actual loading apron');
      assert.equal(Math.sign(entryZ), Math.sign(localZ));
      assert.ok(access.points.length >= 2);
      near(access.points[0].x, access.entry.x); near(access.points[0].z, access.entry.z);
      assert.ok(access.surfaceIndices.length > 0);
      for (const index of access.surfaceIndices) {
        assert.ok(Number.isSafeInteger(index) && index >= 0 && index < roads.surfaces.length);
        assert.ok(connected.has(index));
      }
      for (let segment = 1; segment < access.points.length; segment++) {
        const from = access.points[segment - 1], to = access.points[segment];
        assert.ok(Math.abs(from.x - to.x) < EPSILON || Math.abs(from.z - to.z) < EPSILON, 'access paths use visible orthogonal road segments');
        const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 5));
        for (let sample = 0; sample <= count; sample++) {
          const point = { x: from.x + (to.x - from.x) * sample / count, z: from.z + (to.z - from.z) * sample / count };
          assert.ok(roads.surfaces.some((surface, index) => connected.has(index) && containsPoint(surface, point)),
            `${building.label} path has an unpaved gap at ${point.x}/${point.z}`);
          for (const side of [-1, 1]) {
            const edge = Math.abs(from.x - to.x) < EPSILON
              ? { x: point.x + side * 2.5, z: point.z }
              : { x: point.x, z: point.z + side * 2.5 };
            assert.ok(roads.surfaces.some((surface, index) => connected.has(index) && containsPoint(surface, edge)),
              `${building.label} carriageway is narrower than 5m at ${point.x}/${point.z}`);
          }
        }
      }
    }
  });

  test(`${mapId} full driveways avoid every low solid and remain inside playable dry land`, () => {
    const layout = getMapLayout(mapId), map = getMapSpec(mapId);
    // Four-metre vehicles pass below high pipe bridges, but not through cargo,
    // walls, lower stacked containers or ground-level pipe supports.
    const solids = layout.boxes.filter(box => box.base < 6.5 && box.base + box.height > 2.35);
    for (const surface of layout.roads.surfaces) {
      assert.ok(surface.width > 0 && surface.depth > 0);
      assert.ok(surface.x - surface.width / 2 >= map.bounds.minX - EPSILON
        && surface.x + surface.width / 2 <= (mapId === 'harbor' ? HARBOR_SHORE_X : map.bounds.maxX) + EPSILON
        && surface.z - surface.depth / 2 >= map.bounds.minZ - EPSILON
        && surface.z + surface.depth / 2 <= map.bounds.maxZ + EPSILON,
      `driveway leaves playable dry land: ${JSON.stringify(surface)}`);
      for (const box of solids) assert.equal(overlapsSolid(surface, box), false,
        `asphalt runs through a low solid at ${box.x}/${box.z}, base ${box.base}`);
    }
  });

  test(`${mapId} service junctions have real open arms with pedestrian stripes and interrupted kerbs`, () => {
    const roads = getMapLayout(mapId).roads;
    assert.ok(roads.intersections.length > 21, 'new branches have explicit junction layouts');
    for (const kerb of roads.kerbs) assert.ok(roads.surfaces.every(surface => !overlaps(kerb, surface)),
      'all paved branches remain open, including joins between private drives');
    for (const junction of roads.intersections) {
      assert.ok(junction.crossings.length === 3 || junction.crossings.length === 4, 'T junctions have three arms and crossroads four');
      assert.equal(new Set(junction.crossings.map(crossing => crossing.direction)).size, junction.crossings.length);
      assert.ok(roads.surfaces.some(surface => containsPoint(surface, junction)), 'junction sits on the actual road union');
      assert.ok(roads.kerbs.every(kerb => !overlaps(kerb, junction)), `kerb blocks the junction at ${junction.x}/${junction.z}`);
      assert.ok(roads.markings.every(marking => !overlaps(marking, junction)), 'junction center has no conflicting lane lines');
      for (const crossing of junction.crossings) {
        assert.ok(roads.surfaces.some(surface => containsRect(surface, crossing)), 'crossings belong to paved road arms');
        assert.ok(!overlaps(crossing, junction));
        assert.ok(roads.kerbs.every(kerb => !overlaps(kerb, crossing)), 'a kerb cannot fence off a pedestrian crossing');
        const stripes = roads.markings.filter(marking => marking.kind === 'zebra' && containsRect(crossing, marking));
        assert.ok(stripes.length >= 3, 'every open arm has repeated zebra stripes');
        assert.ok(roads.markings.filter(marking => marking.kind !== 'zebra').every(marking => !overlaps(marking, crossing)),
          'lane lines and stop bars do not run through the crossing');
      }
    }
  });

  test(`${mapId} rendered private drives remain segmented and replace the competing concrete ground face`, () => {
    const { scenery, dispose } = urbanWorldFixture(mapId);
    try {
      const ground = scenery.scene.getObjectByName('Industrial ground surface');
      assert.ok(ground instanceof THREE.InstancedMesh);
      const asphalt: THREE.InstancedMesh[] = [];
      scenery.scene.traverse(object => {
        if (object instanceof THREE.InstancedMesh && object.material instanceof THREE.MeshStandardMaterial
          && object.material.color.getHexString() === (mapId === 'factory' ? '545957' : '515b5b')) asphalt.push(object);
      });
      assert.ok(asphalt.length > 0);
      const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
      for (const mesh of asphalt) {
        assert.ok(mesh.material instanceof THREE.MeshStandardMaterial && mesh.material.polygonOffset,
          'private drives retain the distant-surface depth offset');
        assert.notEqual(mesh.name, 'Industrial surface details', 'access roads never vanish with building detail LOD');
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, matrix); matrix.decompose(position, quaternion, scale);
          assert.ok(scale.x <= 128.001 && scale.z <= 128.001, 'new road triangles retain the 128m span bound');
        }
      }
      scenery.scene.updateMatrixWorld(true);
      const accesses = getMapLayout(mapId).accesses;
      for (let i = 0; i < accesses.length; i += Math.max(1, Math.floor(accesses.length / 12))) {
        const access = accesses[i], from = access.points[0], to = access.points[1];
        const point = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
        const ray = new THREE.Raycaster(new THREE.Vector3(point.x, 450, point.z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObjects(asphalt)[0];
        assert.ok(hit, `${access.label} private drive is missing in the real scene`);
        near(hit.point.y, 2.0225);
        assert.equal(ray.intersectObject(ground).length, 0, 'concrete beneath a private drive would reintroduce Z-fighting');
      }
    } finally { dispose(); }
  });

  test(`${mapId} the expanded street-light grid keeps rendered poles outside roads and every authored solid`, () => {
    const { scenery, dispose } = urbanWorldFixture(mapId);
    try {
      const layout = getMapLayout(mapId), poles: THREE.Vector3[] = [];
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion();
      scenery.scene.updateMatrixWorld(true);
      scenery.scene.traverse(object => {
        if (!(object instanceof THREE.InstancedMesh) || object.geometry.type !== 'CylinderGeometry') return;
        for (let index = 0; index < object.count; index++) {
          object.getMatrixAt(index, matrix); matrix.premultiply(object.matrixWorld); matrix.decompose(position, quaternion, scale);
          if (Math.abs(scale.x - 0.14) < EPSILON && Math.abs(scale.z - 0.14) < EPSILON && Math.abs(scale.y - 13) < EPSILON)
            poles.push(position.clone());
        }
      });
      assert.ok(poles.length > 20, 'the extended road grid retains visible street lighting');
      for (const pole of poles) {
        assert.ok(layout.roads.surfaces.every(surface => !overlaps(surface,
          { x: pole.x, z: pole.z, width: 0.28, depth: 0.28 })), 'street poles cannot stand in the carriageway');
        for (const box of layout.boxes) {
          if (box.base >= pole.y + 6.5 || box.base + box.height <= pole.y - 6.5) continue;
          const c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0), dx = pole.x - box.x, dz = pole.z - box.z;
          const x = Math.max(0, Math.abs(dx * c - dz * s) - box.width / 2);
          const z = Math.max(0, Math.abs(dx * s + dz * c) - box.depth / 2);
          assert.ok(x * x + z * z >= 0.14 ** 2 - EPSILON,
            `lamp at ${pole.x}/${pole.z} intersects a solid at ${box.x}/${box.z}`);
        }
      }
    } finally { dispose(); }
  });
}

test('resident urban map resources stay within the three-map preload budget after adding private roads', () => {
  const fixtures = [urbanWorldFixture('factory'), urbanWorldFixture('harbor')];
  try {
    const geometries = new Set<THREE.BufferGeometry>(), attributes = new Set<THREE.BufferAttribute>();
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    let matrices = 0;
    for (const { scenery } of fixtures) scenery.scene.traverse(object => {
      if (object instanceof THREE.InstancedMesh) matrices += object.instanceMatrix.array.byteLength;
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          if (material instanceof THREE.ShaderMaterial) {
            for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
          }
        }
      }
    });
    let buffers = matrices, pixels = 0;
    for (const geometry of geometries) {
      for (const attribute of Object.values(geometry.attributes)) {
        if (attribute instanceof THREE.BufferAttribute && !attributes.has(attribute)) {
          attributes.add(attribute); buffers += attribute.array.byteLength;
        }
      }
      if (geometry.index && !attributes.has(geometry.index)) { attributes.add(geometry.index); buffers += geometry.index.array.byteLength; }
    }
    for (const texture of textures) pixels += (texture.image?.width ?? 0) * (texture.image?.height ?? 0) * 4;
    assert.ok(buffers < 64 * 1024 * 1024, `urban geometry/instance buffers exceed 64MiB: ${buffers}`);
    assert.ok(pixels < 100 * 1024 * 1024, `urban decoded texture pixels exceed 100MiB: ${pixels}`);
    assert.ok(materials.size < 700, `road rectangles must share materials: ${materials.size}`);
  } finally { fixtures.forEach(fixture => fixture.dispose()); }
});

test('three resident native worlds and services fit one small WASM allocation with no extra map runtimes', () => {
  const runtime = createRustRuntime(flightModule);
  const residents = MAPS.map(map => {
    const world = createWorldKernel(runtime, map.id);
    return { map, world, flight: createWorldFlightSimulation(runtime, world.handle), weapons: createWeaponSimulation(runtime, world, map.targets) };
  });
  try {
    assert.equal(new Set(residents.map(resident => resident.world.handle)).size, 3);
    assert.ok(runtime.memory.buffer.byteLength < 8 * 1024 * 1024, 'the three map simulations fit within 8MiB of shared native memory');
    for (const { map, world, weapons } of residents) {
      assert.equal(world.intersectsObstacle(map.spawn), false);
      assert.equal(weapons.state.ammo, 6);
      assert.equal(weapons.state.score, 0);
      for (const access of getMapLayout(map.id).accesses) {
        for (const point of [access.points[0], access.points[Math.floor(access.points.length / 2)], access.points.at(-1)!]) {
          assert.equal(world.isWater(point.x, point.z), false, `${access.label} native access remains on dry land`);
          assert.equal(world.intersectsObstacle({ ...point, y: 3.5 }), false, `${access.label} native access is physically open`);
        }
      }
    }
  } finally { residents.forEach(resident => { resident.weapons.dispose(); resident.flight.dispose(); resident.world.dispose(); }); }
});
