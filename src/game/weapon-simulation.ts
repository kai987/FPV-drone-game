import type { Vec3 } from './flight.ts';
import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';
import {
  BLAST_RADIUS, BOMB_CAPACITY, BOMB_GRAVITY, DROP_COOLDOWN, EXPLOSION_LIFETIME,
  MAX_ACTIVE_BOMBS, MAX_ACTIVE_EXPLOSIONS, MAX_SUBSTEP, MAX_SUBSTEPS,
  RELOAD_TIME, TARGETS, TIMER_EPSILON,
} from './weapons.ts';
import type { WeaponState } from './weapons.ts';

const MAX_TARGETS = 16;
const INPUT_LENGTH = 51;
const BOMB_OFFSET = 10;
const EXPLOSION_OFFSET = BOMB_OFFSET + MAX_ACTIVE_BOMBS * 7;
const TARGET_OFFSET = EXPLOSION_OFFSET + MAX_ACTIVE_EXPLOSIONS * 6;
const OUTPUT_LENGTH = TARGET_OFFSET + MAX_TARGETS;

export interface WeaponSimulation {
  /** A decoded snapshot; edits to it never alter Rust's persistent simulation. */
  readonly state: WeaponState;
  reset(): WeaponState;
  drop(position: Vec3, velocity: Vec3): boolean;
  step(dt: number): { state: WeaponState; impacts: number; hits: number };
  dispose(): void;
}

function packetCount(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error('Invalid count in Rust weapon packet');
  }
  return value;
}

/** A single shared-memory packet carries every active projectile and explosion. */
export function createWeaponSimulation(runtime: RustRuntime, world: WorldKernel): WeaponSimulation {
  if (runtime.call('weapons_input_len') !== INPUT_LENGTH
    || runtime.call('weapons_output_len') !== OUTPUT_LENGTH || TARGETS.length > MAX_TARGETS) {
    throw new Error('Unsupported Rust weapon interface');
  }
  const handle = runtime.call('weapons_new', world.handle);
  if (!handle) throw new Error('Weapon simulation allocation failed');
  const inputPointer = runtime.call('weapons_input_ptr', handle);
  const outputPointer = runtime.call('weapons_output_ptr', handle);
  const readState = (): WeaponState => {
    const output = runtime.view(outputPointer, OUTPUT_LENGTH);
    const bombCount = packetCount(output[5], MAX_ACTIVE_BOMBS);
    const explosionCount = packetCount(output[6], MAX_ACTIVE_EXPLOSIONS);
    const hitCount = packetCount(output[7], TARGETS.length);
    return {
      ammo: output[0], reloadRemaining: output[1], cooldown: output[2],
      score: output[3], nextId: output[4],
      bombs: Array.from({ length: bombCount }, (_, index) => {
        const offset = BOMB_OFFSET + index * 7;
        return { id: output[offset],
          position: { x: output[offset + 1], y: output[offset + 2], z: output[offset + 3] },
          velocity: { x: output[offset + 4], y: output[offset + 5], z: output[offset + 6] } };
      }),
      explosions: Array.from({ length: explosionCount }, (_, index) => {
        const offset = EXPLOSION_OFFSET + index * 6;
        return { id: output[offset],
          position: { x: output[offset + 1], y: output[offset + 2], z: output[offset + 3] },
          age: output[offset + 4], hitCount: output[offset + 5] };
      }),
      hitTargetIds: Array.from({ length: hitCount }, (_, index) => {
        const targetIndex = packetCount(output[TARGET_OFFSET + index], TARGETS.length - 1);
        return TARGETS[targetIndex].id;
      }),
    };
  };
  try {
    const input = runtime.view(inputPointer, INPUT_LENGTH);
    input.fill(0);
    input.set([BOMB_CAPACITY, BOMB_GRAVITY, DROP_COOLDOWN, RELOAD_TIME, BLAST_RADIUS,
      EXPLOSION_LIFETIME, MAX_ACTIVE_BOMBS, MAX_ACTIVE_EXPLOSIONS, MAX_SUBSTEP,
      MAX_SUBSTEPS, TIMER_EPSILON, TARGETS.length]);
    TARGETS.forEach((target, index) => input.set([target.position.x, target.position.z], 12 + index * 2));
    if (runtime.call('weapons_configure', handle) !== 1) throw new Error('Invalid shared weapon configuration');
  } catch (error) {
    runtime.call('weapons_free', handle);
    throw error;
  }
  let state = readState();
  let disposed = false;
  let busy = false;
  const ensureOpen = () => {
    if (disposed) throw new Error('Weapon simulation has been disposed');
    if (busy) throw new Error('Weapon simulation cannot reenter a call');
  };
  return {
    get state() { ensureOpen(); return state; },
    reset() {
      ensureOpen(); busy = true;
      try { runtime.call('weapons_reset', handle); state = readState(); return state; }
      finally { busy = false; }
    },
    drop(position, velocity) {
      ensureOpen(); busy = true;
      try {
        runtime.view(inputPointer, INPUT_LENGTH).set([
          position.x, position.y, position.z, velocity.x, velocity.y, velocity.z,
        ], 44);
        const dropped = runtime.call('weapons_drop', handle) === 1;
        state = readState();
        return dropped;
      } finally { busy = false; }
    },
    step(dt) {
      ensureOpen(); busy = true;
      try {
        runtime.view(inputPointer, INPUT_LENGTH)[50] = dt;
        runtime.call('weapons_step', handle);
        state = readState();
        const output = runtime.view(outputPointer, OUTPUT_LENGTH);
        return { state, impacts: output[8], hits: output[9] };
      } finally { busy = false; }
    },
    dispose() {
      if (disposed) return;
      ensureOpen();
      runtime.call('weapons_free', handle);
      disposed = true;
    },
  };
}
