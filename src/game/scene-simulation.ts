import * as THREE from 'three';
import { LAKES, RIVER_SAMPLES, WORLD_BOUNDS, WATER_LEVEL, lakeBoundary } from './landscape.ts';
import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';
import type { Target } from './weapons.ts';

export interface TreePlacement { x: number; z: number; y: number; height: number; width: number; angle: number; shade: number }
export interface StonePlacement { x: number; y: number; z: number; rotation: number[]; scale: number[]; tint: number; radius: number; height: number }
export interface ShrubPlacement { x: number; y: number; z: number; height: number; seed: number }
export interface SceneSimulation {
  placements: { trees: TreePlacement[]; rocks: StonePlacement[]; banks: StonePlacement[]; shrubs: ShrubPlacement[] };
  terrainColors(points: Float32Array, heights: Float32Array, distances: Float32Array, subdivisions: number, spacing: number): Float32Array;
  waterData(points: Float32Array, heights: Float32Array): { depths: Float32Array; currents: Float32Array };
  ripplePixels(size?: number): Uint8Array;
  dispose(): void;
}
const BATCH = 512;

/** Ripple generation has no scene/world handle; copy before releasing its Rust buffer. */
export function generateRipplePixels(runtime: RustRuntime, size = 256): Uint8Array {
  const ripple = runtime.call('scene_ripple_new', size);
  if (!ripple) throw new Error('Ripple size must be between 16 and 512');
  try { return new Uint8Array(runtime.memory.buffer, runtime.call('scene_ripple_ptr', ripple), size * size * 4).slice(); }
  finally { runtime.call('scene_ripple_free', ripple); }
}

/** One scene-generation batch; randomness has the same seed/ordering as before. */
export function createSceneSimulation(runtime: RustRuntime, world: WorldKernel,
  course: readonly { x: number; z: number }[], targets: readonly Target[], randomSkip: number): SceneSimulation {
  const config = new Float64Array([
    1074, randomSkip, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ,
    course.length, targets.length, RIVER_SAMPLES.length, LAKES.length,
    ...course.flatMap(p => [p.x, p.z]), ...targets.flatMap(t => [t.position.x, t.position.z, t.radius]),
    ...RIVER_SAMPLES.flatMap(p => [p.x, p.z, p.halfWidth]),
    ...LAKES.flatMap(lake => {
      const boundary = lakeBoundary(lake, 128);
      return [lake.x, lake.z, lake.radiusX, lake.radiusZ, lake.rotation, boundary.length, ...boundary.flatMap(p => [p.x, p.z])];
    }),
  ]);
  const handle = runtime.call('scene_new', config.length);
  if (!handle) throw new Error('Scene batch allocation failed');
  try {
    runtime.view(runtime.call('scene_config_ptr', handle), config.length).set(config);
    if (runtime.call('scene_generate', handle, world.handle) !== 1) throw new Error('Scene generation failed');
  } catch (error) { runtime.call('scene_free', handle); throw error; }
  const output = runtime.view(runtime.call('scene_output_ptr', handle), runtime.call('scene_output_len', handle));
  const [treeCount, rockCount, bankCount, shrubCount] = output;
  let at = 4;
  const trees = Array.from({ length: treeCount }, () => {
    const values = output.subarray(at, at += 7);
    return { x: values[0], z: values[1], y: values[2], height: values[3], width: values[4], angle: values[5], shade: values[6] };
  });
  const stones = (count: number) => Array.from({ length: count }, () => {
    const values = output.subarray(at, at += 12);
    return { x: values[0], y: values[1], z: values[2], rotation: Array.from(values.subarray(3, 6)),
      scale: Array.from(values.subarray(6, 9)), tint: values[9], radius: values[10], height: values[11] };
  });
  const rocks = stones(rockCount); const banks = stones(bankCount);
  const shrubs = Array.from({ length: shrubCount }, () => {
    const values = output.subarray(at, at += 5);
    return { x: values[0], y: values[1], z: values[2], height: values[3], seed: values[4] };
  });
  const inputPointer = runtime.call('scene_input_ptr', handle);
  const outputPointer = runtime.call('scene_batch_ptr', handle);
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Scene simulation has been disposed'); };
  const palette = ['#bdc4a1', '#c3c2b5', '#d0c0a0', '#84917d'].flatMap(hex => new THREE.Color(hex).toArray());
  return {
    placements: { trees, rocks, banks, shrubs },
    terrainColors(points, heights, distances, subdivisions, spacing) {
      live(); const result = new Float32Array(heights.length * 3); const rowSize = subdivisions + 1;
      for (let start = 0; start < heights.length; start += BATCH) {
        const count = Math.min(BATCH, heights.length - start);
        const input = runtime.view(inputPointer, 13 + count * 8); input.set(palette); input[12] = spacing;
        for (let n = 0; n < count; n++) {
          const i = start + n; const col = i % rowSize; const row = Math.floor(i / rowSize);
          input.set([points[i * 2], points[i * 2 + 1], heights[i], heights[i - (col > 0 ? 1 : 0)],
            heights[i + (col < subdivisions ? 1 : 0)], heights[i - (row > 0 ? rowSize : 0)],
            heights[i + (row < subdivisions ? rowSize : 0)], distances[i]], 13 + n * 8);
        }
        runtime.call('scene_colors', handle, count); result.set(runtime.view(outputPointer, count * 3), start * 3);
      }
      return result;
    },
    waterData(points, heights) {
      live(); const depths = new Float32Array(heights.length); const currents = new Float32Array(heights.length * 3);
      for (let start = 0; start < heights.length; start += BATCH) {
        const count = Math.min(BATCH, heights.length - start); const input = runtime.view(inputPointer, count * 3);
        for (let i = 0; i < count; i++) input.set([points[(start + i) * 2], points[(start + i) * 2 + 1], heights[start + i]], i * 3);
        runtime.call('scene_water', handle, world.handle, count, WATER_LEVEL); const output = runtime.view(outputPointer, count * 4);
        for (let i = 0; i < count; i++) { depths[start + i] = output[i * 4]; currents.set(output.subarray(i * 4 + 1, i * 4 + 4), (start + i) * 3); }
      }
      return { depths, currents };
    },
    ripplePixels(size = 256) {
      live(); return generateRipplePixels(runtime, size);
    },
    dispose() { if (disposed) return; disposed = true; runtime.call('scene_free', handle); },
  };
}
