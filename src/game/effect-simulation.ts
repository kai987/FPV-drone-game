import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';
import type { FishSchool } from './rural-layout.ts';
import type { Vec3 } from './flight.ts';

/** Each service owns fixed Rust buffers; views are reacquired after calls that can grow memory. */
function createBuffers(runtime: RustRuntime, kind: number, config: readonly number[], inputLength: number, outputLength: number) {
  const handle = runtime.call('effects_new', kind, config.length, inputLength, outputLength);
  if (!handle) throw new Error('Could not allocate Rust animation buffers');
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    runtime.call('effects_free', handle);
  };
  try {
    runtime.view(runtime.call('effects_config_ptr', handle), config.length).set(config);
    if (!runtime.call('effects_initialize', handle)) throw new Error('Invalid Rust animation layout');
    const inputPointer = runtime.call('effects_input_ptr', handle);
    const outputPointer = runtime.call('effects_output_ptr', handle);
    const live = () => { if (disposed) throw new Error('Rust animation has been disposed'); };
    return {
      input() { live(); return runtime.view(inputPointer, inputLength); },
      update(time: number, world?: WorldKernel, night = false) {
        live();
        if (!runtime.call('effects_update', handle, time, world?.handle ?? 0, Number(night))) throw new Error('Invalid Rust animation tick');
        return runtime.view(outputPointer, outputLength);
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}

export function createFishSimulation(runtime: RustRuntime, schools: readonly FishSchool[], waterLevel: number) {
  const count = schools.reduce((sum, school) => sum + school.count, 0);
  const config = [waterLevel, schools.length, count, ...new Array(schools.length * 5).fill(0)];
  schools.forEach((school, index) => {
    const offset = 3 + index * 5;
    let length = 0;
    school.points.forEach((point, i) => {
      const next = school.points[(i + 1) % school.points.length];
      length += Math.hypot(next.x - point.x, next.z - point.z);
    });
    config.splice(offset, 5, school.count, school.spread, length, config.length, school.points.length);
    for (const point of school.points) config.push(point.x, point.z);
  });
  const buffers = createBuffers(runtime, 0, config, 0, count * 9 * 16);
  return { update: (time: number) => buffers.update(time), dispose: buffers.dispose };
}

export interface AnimalAnimation {
  species: 'cow' | 'sheep'; field: { x: number; z: number };
  phase: number; radius: number; offset: number; size: number; activityOffset: number;
}
export interface AnimalPart { parent: number; local: readonly number[] }

/** Parent order: root/head/neck/tail, then each leg's three bones, three joints, foot. */
export function createLivestockSimulation(runtime: RustRuntime, animals: readonly AnimalAnimation[], parts: readonly AnimalPart[], world?: WorldKernel) {
  const config = [animals.length, parts.length];
  for (const animal of animals) config.push(Number(animal.species === 'cow'), animal.field.x, animal.field.z,
    animal.phase, animal.radius, animal.offset, animal.size, animal.activityOffset);
  for (const part of parts) config.push(part.parent, ...part.local);
  const buffers = createBuffers(runtime, 1, config, 0, parts.length * 16);
  return { update: (time: number) => buffers.update(time, world), dispose: buffers.dispose };
}

export const PARTICLES_PER_EXPLOSION = [18, 8, 12, 14, 22, 1] as const;
export interface EffectFieldLayout { capacity: number; matrices: number; colors: number; opacity: number; seed: number }
export function explosionLayout(capacity: number) {
  let offset = 9;
  const field = (count: number, seed: boolean): EffectFieldLayout => {
    const matrices = offset; const colors = matrices + count * 16; const opacity = colors + count * 3;
    const seedOffset = opacity + count;
    offset += count * (seed ? 21 : 20);
    return { capacity: count, matrices, colors, opacity, seed: seedOffset };
  };
  const fields = PARTICLES_PER_EXPLOSION.map(perExplosion => field(capacity * perExplosion, true));
  const rings = field(capacity * 3, false);
  const fragments = offset; offset += capacity * 16 * 16;
  const lights = offset; offset += 3 * 7;
  return { fields, rings, fragments, lights, length: offset };
}
export interface ExplosionAnimation {
  id: number; position: Vec3; age: number;
  /** Only used by independent flat-world tests; production uses native map queries. */
  waterImpact?: boolean;
}
export interface ExplosionAnimationConfig {
  capacity: number; lifetime: number; blastRadius: number; waterLevel: number;
  /** Linear RGB, in order: smoke/dust/water/flame/warm white/land light/water light. */
  colors: readonly number[];
}
export function createExplosionSimulation(runtime: RustRuntime, config: ExplosionAnimationConfig, world?: WorldKernel) {
  const layout = explosionLayout(config.capacity);
  const buffers = createBuffers(runtime, 2, [config.capacity, config.lifetime, config.blastRadius, config.waterLevel, ...config.colors],
    1 + config.capacity * 6, layout.length);
  return {
    layout,
    update(explosions: readonly ExplosionAnimation[], time: number, night = false) {
      const input = buffers.input();
      const count = Math.min(explosions.length, config.capacity); input[0] = count;
      for (let i = 0; i < count; i++) {
        const explosion = explosions[explosions.length - count + i];
        const offset = 1 + i * 6;
        input[offset] = explosion.id; input[offset + 1] = explosion.position.x;
        input[offset + 2] = explosion.position.y; input[offset + 3] = explosion.position.z;
        input[offset + 4] = explosion.age; input[offset + 5] = Number(explosion.waterImpact ?? false);
      }
      return buffers.update(time, world, night);
    },
    dispose: buffers.dispose,
  };
}
