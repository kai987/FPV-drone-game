import { resolveFlightConfig } from './drone-catalog.ts';
import type { DroneProfile } from './drone-catalog.ts';
import type { FlightInput, FlightMode, FlightState, Vec3 } from './flight.ts';
import type { Telemetry } from './types.ts';
import { WIND_PRESETS } from './wind.ts';
import type { WindSettings } from './wind.ts';
import type { RustRuntime } from './rust-runtime.ts';

export interface SimulationBounds {
  minX: number; maxX: number; minZ: number; maxZ: number; maxAltitude: number;
}
export interface SimulationStep {
  wind: Telemetry['wind'];
  windClock: number;
  boundaryContact: boolean;
  obstacleContact: boolean;
}
export interface FlightSimulation {
  /** One Rust invocation integrates motion, contacts and wind telemetry. */
  step(state: FlightState, input: FlightInput, dt: number, mode: FlightMode,
    profile: Readonly<DroneProfile>, wind: WindSettings, windClock: number,
    bounds?: SimulationBounds, windOverride?: Vec3): SimulationStep;
  dispose(): void;
}
interface FlightCoreExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  abi_version: () => number;
  input_len: () => number;
  output_len: () => number;
  simulation_new: () => number;
  simulation_input_ptr: (handle: number) => number;
  simulation_output_ptr: (handle: number) => number;
  simulate_tick: (handle: number) => void;
  simulation_free: (handle: number) => void;
}

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const RELATIVE = ['迎风', '右前侧风', '右侧风', '右后侧风', '顺风', '左后侧风', '左侧风', '左前侧风'];
const directionLabel = (sector: number) => sector === -1 ? '无风' : sector === -2 ? '垂直阵风' : COMPASS[sector];
const relativeLabel = (sector: number) => sector === -1 ? '无风' : sector === -2 ? '垂直阵风' : RELATIVE[sector];

/** Map queries stay in the scene layer; Rust owns their effect on flight state. */
export function createFlightSimulation(module: WebAssembly.Module,
  surfaceHeight: (x: number, z: number, fromY: number) => number,
  obstacleHit: (position: Vec3) => boolean = () => false): FlightSimulation {
  const instance = new WebAssembly.Instance(module, {
    env: {
      surface_height: surfaceHeight,
      obstacle_hit: (x: number, y: number, z: number) => obstacleHit({ x, y, z }) ? 1 : 0,
    },
  });
  const core = instance.exports as FlightCoreExports;
  return createSimulationAdapter(core, handle => core.simulate_tick(handle));
}

/** Production flight queries the native Rust world in the same shared instance. */
export function createWorldFlightSimulation(runtime: RustRuntime, worldHandle: number): FlightSimulation {
  const call = (name: string) => (...args: number[]) => runtime.call(name, ...args);
  const core = { memory: runtime.memory, abi_version: call('abi_version'), input_len: call('input_len'),
    output_len: call('output_len'), simulation_new: call('simulation_new'), simulation_input_ptr: call('simulation_input_ptr'),
    simulation_output_ptr: call('simulation_output_ptr'), simulation_free: call('simulation_free'), simulate_tick: call('simulate_tick') } as FlightCoreExports;
  return createSimulationAdapter(core, handle => {
    if (runtime.call('simulate_world_tick', handle, worldHandle) !== 1) throw new Error('Native world flight tick failed');
  });
}

function createSimulationAdapter(core: FlightCoreExports, tick: (handle: number) => void): FlightSimulation {
  if (!(core.memory instanceof WebAssembly.Memory) || typeof core.abi_version !== 'function'
    || core.abi_version() !== 1 || core.input_len() !== 36 || core.output_len() !== 22) {
    throw new Error('Unsupported flight-core WASM interface');
  }
  const handle = core.simulation_new();
  if (!handle) throw new Error('Flight simulation allocation failed');
  const inputPointer = core.simulation_input_ptr(handle);
  const outputPointer = core.simulation_output_ptr(handle);
  let memory = core.memory.buffer;
  let inputBuffer = new Float64Array(memory, inputPointer, 36);
  let outputBuffer = new Float64Array(memory, outputPointer, 22);
  let disposed = false;
  let stepping = false;
  const refreshViews = () => {
    // A future allocation may grow memory and detach old typed-array views.
    if (memory === core.memory.buffer) return;
    memory = core.memory.buffer;
    inputBuffer = new Float64Array(memory, inputPointer, 36);
    outputBuffer = new Float64Array(memory, outputPointer, 22);
  };
  return {
    step(state, input, dt, mode, profile, wind, windClock, bounds, windOverride) {
      if (disposed) throw new Error('Flight simulation has been disposed');
      if (stepping) throw new Error('Flight simulation cannot reenter a tick');
      refreshViews();
      const config = resolveFlightConfig(profile, mode, Boolean(input.boost));
      const preset = Object.hasOwn(WIND_PRESETS, wind.strength) ? WIND_PRESETS[wind.strength] : undefined;
      inputBuffer.set([
        state.position.x, state.position.y, state.position.z,
        state.velocity.x, state.velocity.y, state.velocity.z,
        state.yaw, state.pitch, state.roll, state.collision ? 1 : 0,
        input.forward, input.strafe, input.climb, input.yaw, input.lookPitch ?? 0,
        dt, windClock, mode === 'sport' ? 1 : 0,
        config.speed, config.climbSpeed, config.response, config.brake, config.yawSpeed, config.bank,
        preset?.baseSpeed ?? 0, wind.direction,
        bounds ? 1 : 0, bounds?.minX ?? 0, bounds?.maxX ?? 0, bounds?.minZ ?? 0, bounds?.maxZ ?? 0, bounds?.maxAltitude ?? 0,
        windOverride ? 1 : 0, windOverride?.x ?? 0, windOverride?.y ?? 0, windOverride?.z ?? 0,
      ]);
      stepping = true;
      try { tick(handle); } finally { stepping = false; }
      refreshViews();
      if (Number.isFinite(dt) && dt > 0) {
        state.position.x = outputBuffer[0]; state.position.y = outputBuffer[1]; state.position.z = outputBuffer[2];
        state.velocity.x = outputBuffer[3]; state.velocity.y = outputBuffer[4]; state.velocity.z = outputBuffer[5];
        state.yaw = outputBuffer[6]; state.pitch = outputBuffer[7]; state.roll = outputBuffer[8]; state.collision = outputBuffer[9] !== 0;
      }
      return {
        windClock: outputBuffer[10],
        wind: {
          vector: { x: outputBuffer[11], y: outputBuffer[12], z: outputBuffer[13] },
          speed: outputBuffer[14], fromDegrees: outputBuffer[15], headwind: outputBuffer[16], crosswind: outputBuffer[17],
          directionLabel: directionLabel(outputBuffer[18]), relativeLabel: relativeLabel(outputBuffer[19]),
        },
        boundaryContact: outputBuffer[20] !== 0, obstacleContact: outputBuffer[21] !== 0,
      };
    },
    dispose() {
      if (disposed) return;
      if (stepping) throw new Error('Flight simulation cannot be disposed during a tick');
      disposed = true;
      core.simulation_free(handle);
    },
  };
}
