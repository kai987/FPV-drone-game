import { LAKES, RIVER_SAMPLES, WATER_LEVEL } from './landscape.ts';
import { BRIDGES, CABINS, PASTURES } from './rural-layout.ts';
import { HARBOR_BREAKWATERS, HARBOR_PIERS, HARBOR_SHORE_X, getMapLayout } from './map-layout.ts';
import type { UrbanBox } from './map-layout.ts';
import type { MapId } from './map-catalog.ts';
import type { Vec3 } from './flight.ts';
import type { WorldObstacle } from './world.ts';
import type { RustRuntime } from './rust-runtime.ts';

export interface WorldKernel {
  readonly handle: number;
  groundHeight(x: number, z: number): number;
  waterDistance(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  surfaceHeight(x: number, z: number): number;
  flightSurfaceHeight(x: number, z: number, fromY?: number): number;
  clearance(x: number, z: number, padding?: number): boolean;
  setObstacles(obstacles: readonly WorldObstacle[]): void;
  setBoxes(boxes: readonly UrbanBox[]): void;
  /** Scene-authored shoreline-connected piers and breakwaters; failed uploads preserve prior geometry. */
  setHarborGeometry(shoreX: number, lands: readonly UrbanBox[]): void;
  intersectsObstacle(position: Vec3): boolean;
  /** Packed x,z pairs; heights/distances match Three.js Float32 attributes. */
  sampleTerrain(points: Float32Array | Float64Array): { heights: Float32Array; waterDistances: Float32Array };
  dispose(): void;
}

/** Upload scene geometry once; all numeric queries use the shared Rust instance. */
export function createWorldKernel(runtime: RustRuntime, mapId: MapId = 'valley'): WorldKernel {
  const configuration = new Float64Array([
    WATER_LEVEL, RIVER_SAMPLES.length, LAKES.length, CABINS.length, BRIDGES.length, PASTURES.length,
    ...RIVER_SAMPLES.flatMap(sample => [sample.x, sample.z, sample.halfWidth]),
    ...LAKES.flatMap(lake => [lake.x, lake.z, lake.radiusX, lake.radiusZ, lake.rotation, lake.id === 'main-lake' ? 0.6 : -0.7]),
    ...CABINS.flatMap(cabin => [cabin.x, cabin.z, cabin.yaw, cabin.width, cabin.depth, cabin.wallHeight, cabin.roofHeight, cabin.baseY]),
    ...BRIDGES.flatMap(bridge => [bridge.x, bridge.z, bridge.yaw, bridge.length, bridge.width, bridge.span, bridge.rampLength, bridge.deckY, bridge.landingA.y, bridge.landingB.y]),
    ...PASTURES.flatMap(pasture => [pasture.x, pasture.z, pasture.radius]),
  ]);
  const handle = runtime.call('world_new', configuration.length);
  if (!handle) throw new Error('World kernel allocation failed');
  try {
    runtime.view(runtime.call('world_config_ptr', handle), configuration.length).set(configuration);
    if (runtime.call('world_configure', handle) !== 1) throw new Error('World geometry configuration is invalid');
    if (runtime.call('world_set_map_kind', handle, mapId === 'factory' ? 1 : mapId === 'harbor' ? 2 : 0) !== 1) {
      throw new Error('World map configuration is invalid');
    }
  } catch (error) { runtime.call('world_free', handle); throw error; }
  const queryPointer = runtime.call('world_query_ptr', handle);
  const batchCapacity = runtime.call('world_batch_capacity');
  const batchInputPointer = runtime.call('world_batch_input_ptr', handle);
  const batchOutputPointer = runtime.call('world_batch_output_ptr', handle);
  let disposed = false;
  const live = () => { if (disposed) throw new Error('World kernel has been disposed'); };
  const query = (kind: number, x: number, z: number, parameter = 0) => {
    live();
    const buffer = runtime.view(queryPointer, 4);
    buffer[0] = x; buffer[1] = z; buffer[2] = parameter;
    return runtime.call('world_query', handle, kind);
  };
  const world: WorldKernel = {
    get handle() { live(); return handle; },
    groundHeight: (x, z) => query(0, x, z),
    waterDistance: (x, z) => query(1, x, z),
    isWater: (x, z) => query(2, x, z) !== 0,
    surfaceHeight: (x, z) => query(3, x, z),
    flightSurfaceHeight: (x, z, fromY = Infinity) => query(4, x, z, fromY),
    clearance: (x, z, padding = 0) => query(5, x, z, padding) !== 0,
    intersectsObstacle: position => query(6, position.x, position.z, position.y) !== 0,
    setHarborGeometry(shoreX, lands) {
      live();
      if (!Number.isFinite(shoreX) || lands.some(land => {
        const values = [land.x, land.z, land.width, land.depth, land.base, land.height, land.yaw ?? 0];
        return !values.every(Number.isFinite) || land.width <= 0 || land.depth <= 0 || land.height <= 0
          || (land.yaw ?? 0) !== 0 || Math.abs(land.x - land.width / 2 - shoreX) > 1e-7;
      })) throw new Error('Harbor land geometry must connect to the shoreline with unrotated finite rectangles');
      const configuration = new Float64Array([shoreX, lands.length,
        ...lands.flatMap(land => [land.x + land.width / 2, land.z - land.depth / 2,
          land.z + land.depth / 2, land.base + land.height]),
      ]);
      const pointer = runtime.call('world_harbor_alloc', handle, lands.length);
      if (!pointer) throw new Error('Harbor land allocation failed');
      runtime.view(pointer, configuration.length).set(configuration);
      if (runtime.call('world_configure_harbor', handle, lands.length) !== 1) throw new Error('Harbor land geometry is invalid');
    },
    setObstacles(obstacles) {
      live();
      const pointer = runtime.call('world_obstacles_alloc', handle, obstacles.length);
      if (!pointer) throw new Error('World obstacle allocation failed');
      const buffer = runtime.view(pointer, obstacles.length * 6);
      obstacles.forEach((obstacle, index) => buffer.set([
        obstacle.x, obstacle.z, obstacle.radius, obstacle.height, obstacle.base ?? -Infinity, obstacle.roof ? 1 : 0,
      ], index * 6));
      if (runtime.call('world_set_obstacles', handle, obstacles.length) !== 1) throw new Error('World obstacles are invalid');
    },
    setBoxes(boxes) {
      live();
      const pointer = runtime.call('world_boxes_alloc', handle, boxes.length);
      if (!pointer) throw new Error('World box allocation failed');
      const buffer = runtime.view(pointer, boxes.length * 7);
      boxes.forEach((box, index) => buffer.set([
        box.x, box.z, box.width, box.depth, box.base, box.height, box.yaw ?? 0,
      ], index * 7));
      if (runtime.call('world_set_boxes', handle, boxes.length) !== 1) throw new Error('World boxes are invalid');
    },
    sampleTerrain(points) {
      live();
      if (points.length % 2 !== 0) throw new Error('Terrain samples require packed x,z pairs');
      const count = points.length / 2;
      const heights = new Float32Array(count);
      const waterDistances = new Float32Array(count);
      for (let start = 0; start < count; start += batchCapacity) {
        const size = Math.min(batchCapacity, count - start);
        runtime.view(batchInputPointer, size * 2).set(points.subarray(start * 2, (start + size) * 2));
        if (runtime.call('world_sample_terrain', handle, size) !== size) throw new Error('Terrain batch sampling failed');
        const output = runtime.view(batchOutputPointer, size * 2);
        for (let index = 0; index < size; index++) { heights[start + index] = output[index * 2]; waterDistances[start + index] = output[index * 2 + 1]; }
      }
      return { heights, waterDistances };
    },
    dispose() { if (disposed) return; disposed = true; runtime.call('world_free', handle); },
  };
  try {
    if (mapId === 'harbor') world.setHarborGeometry(HARBOR_SHORE_X, [...HARBOR_PIERS, ...HARBOR_BREAKWATERS]);
    if (mapId !== 'valley') world.setBoxes(getMapLayout(mapId).boxes);
  } catch (error) { world.dispose(); throw error; }
  return world;
}
