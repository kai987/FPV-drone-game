import type { Vec3 } from './flight.ts';
import { GUN_CAPACITY, GUN_MAX_IMPACTS, GUN_MAX_SHOTS } from './gun.ts';
import type { GunState } from './gun.ts';
import type { RustRuntime } from './rust-runtime.ts';
import type { Target } from './weapons.ts';
import type { WorldKernel } from './world-kernel.ts';

const MAX_TARGETS = 16;
const STEP_OFFSET = 1 + MAX_TARGETS * 4;
const INPUT_LENGTH = STEP_OFFSET + 12;
const SHOT_OFFSET = 9;
const IMPACT_OFFSET = SHOT_OFFSET + GUN_MAX_SHOTS * 8;
const TARGET_OFFSET = IMPACT_OFFSET + GUN_MAX_IMPACTS * 6;
const OUTPUT_LENGTH = TARGET_OFFSET + MAX_TARGETS;

export interface GunSimulation {
  /** Detached output snapshot; Rust remains authoritative. */
  readonly state: GunState;
  reset(): GunState;
  /** Optional camera origin converges the muzzle ray onto the visible crosshair. */
  step(dt: number, trigger: boolean, origin: Vec3, direction: Vec3, aimOrigin?: Vec3): { state: GunState; shots: number; hits: number };
  dispose(): void;
}

function count(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error('Invalid count in Rust gun packet');
  return value;
}

export function createGunSimulation(runtime: RustRuntime, world: WorldKernel, targets: readonly Target[]): GunSimulation {
  if (runtime.call('gun_input_len') !== INPUT_LENGTH || runtime.call('gun_output_len') !== OUTPUT_LENGTH
    || targets.length > MAX_TARGETS || new Set(targets.map(target => target.id)).size !== targets.length) {
    throw new Error('Unsupported Rust gun interface or target list');
  }
  const targetIds = targets.map(target => target.id);
  const handle = runtime.call('gun_new', world.handle);
  if (!handle) throw new Error('Gun simulation allocation failed');
  let inputPointer: number, outputPointer: number, state: GunState;
  const readState = (): GunState => {
    const output = runtime.view(outputPointer, OUTPUT_LENGTH);
    const shotCount = count(output[4], GUN_MAX_SHOTS);
    const impactCount = count(output[5], GUN_MAX_IMPACTS);
    const hitCount = count(output[6], targetIds.length);
    return {
      ammo: count(output[0], GUN_CAPACITY), reloadRemaining: output[1],
      score: output[2], totalShots: output[3],
      shots: Array.from({ length: shotCount }, (_, index) => {
        const offset = SHOT_OFFSET + index * 8;
        return { id: output[offset], from: { x: output[offset + 1], y: output[offset + 2], z: output[offset + 3] },
          to: { x: output[offset + 4], y: output[offset + 5], z: output[offset + 6] }, age: output[offset + 7] };
      }),
      impacts: Array.from({ length: impactCount }, (_, index) => {
        const offset = IMPACT_OFFSET + index * 6;
        return { id: output[offset], position: { x: output[offset + 1], y: output[offset + 2], z: output[offset + 3] },
          age: output[offset + 4], hit: output[offset + 5] === 1 };
      }),
      hitTargetIds: Array.from({ length: hitCount }, (_, index) => targetIds[count(output[TARGET_OFFSET + index], targetIds.length - 1)]),
    };
  };
  try {
    inputPointer = runtime.call('gun_input_ptr', handle);
    outputPointer = runtime.call('gun_output_ptr', handle);
    const input = runtime.view(inputPointer, INPUT_LENGTH);
    input.fill(0); input[0] = targets.length;
    targets.forEach((target, index) => input.set([target.position.x, target.position.y, target.position.z, target.radius], 1 + index * 4));
    if (runtime.call('gun_configure', handle) !== 1) throw new Error('Invalid Rust gun target configuration');
    state = readState();
  } catch (error) { runtime.call('gun_free', handle); throw error; }
  let disposed = false, busy = false;
  const live = () => {
    if (disposed) throw new Error('Gun simulation has been disposed');
    if (busy) throw new Error('Gun simulation cannot reenter a call');
    // Fail safely if the owning map was disposed before this service.
    void world.handle;
  };
  return {
    get state() { live(); return state; },
    reset() {
      live(); busy = true;
      try { runtime.call('gun_reset', handle); state = readState(); return state; }
      finally { busy = false; }
    },
    step(dt, trigger, origin, direction, aimOrigin) {
      live(); busy = true;
      try {
        runtime.view(inputPointer, INPUT_LENGTH).set([dt, trigger ? 1 : 0,
          origin.x, origin.y, origin.z, direction.x, direction.y, direction.z,
          aimOrigin ? 1 : 0, aimOrigin?.x ?? 0, aimOrigin?.y ?? 0, aimOrigin?.z ?? 0], STEP_OFFSET);
        runtime.call('gun_step', handle); state = readState();
        const output = runtime.view(outputPointer, OUTPUT_LENGTH);
        return { state, shots: output[7], hits: output[8] };
      } finally { busy = false; }
    },
    dispose() {
      if (disposed) return;
      if (busy) throw new Error('Gun simulation cannot reenter a call');
      runtime.call('gun_free', handle); disposed = true;
    },
  };
}
