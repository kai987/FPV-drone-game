import { DEFAULT_DRONE_ID, getDroneSpec, resolveFlightConfig } from './drone-catalog.ts';
import type { DroneProfile } from './drone-catalog.ts';

/** World coordinates use metres. At yaw 0 the drone faces world -Z. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Signed control axes, each in [-1, 1]. Positive yaw turns left. */
export interface FlightInput {
  forward: number;
  strafe: number;
  climb: number;
  yaw: number;
  lookPitch?: number;
  boost?: boolean;
}

export interface FlightState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  /** True for the simulation step that contacted terrain. */
  collision?: boolean;
}

/** A vertical ring whose yaw points in the intended direction of travel. */
export interface Checkpoint {
  position: Vec3;
  yaw: number;
  radius: number;
}

export type FlightMode = 'assisted' | 'sport';

const TAU = Math.PI * 2;
const MAX_STEP = 0.06;
const GROUND_CLEARANCE = 1.8;
const PITCH_LIMIT = 0.75;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function axis(value = 0): number {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

function wrapAngle(angle: number): number {
  return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

export function createFlightState(
  position: Vec3 = { x: 0, y: 12, z: 55 },
  yaw = 0,
): FlightState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    roll: 0,
    collision: false,
  };
}

/**
 * Mutates and returns the supplied state. Assisted mode brakes quickly and both
 * modes hover without input. Forward follows the camera's yaw and pitch;
 * independent climb controls remain available for precise altitude changes.
 */
export function stepFlight(
  state: FlightState,
  input: FlightInput,
  dt: number,
  mode: FlightMode = 'assisted',
  groundHeight: (x: number, z: number) => number = () => 0,
  profile: Readonly<DroneProfile> = getDroneSpec(DEFAULT_DRONE_ID).flight,
): FlightState {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  const time = Math.min(dt, MAX_STEP);
  const config = resolveFlightConfig(profile, mode, Boolean(input.boost));
  const forward = axis(input.forward);
  const strafe = axis(input.strafe);
  const climb = axis(input.climb);
  const yawInput = axis(input.yaw);

  state.collision = false;
  state.yaw = wrapAngle(state.yaw + yawInput * config.yawSpeed * time);
  state.pitch = clamp(state.pitch + axis(input.lookPitch) * 1.25 * time, -PITCH_LIMIT, PITCH_LIMIT);

  const speed = config.speed;
  const horizontalInputLength = Math.max(1, Math.hypot(forward, strafe));
  const thrust = forward / horizontalInputLength;
  const sideThrust = strafe / horizontalInputLength;
  const sinYaw = Math.sin(state.yaw);
  const cosYaw = Math.cos(state.yaw);
  const cosPitch = Math.cos(state.pitch);
  const target: Vec3 = {
    x: (-sinYaw * cosPitch * thrust + cosYaw * sideThrust) * speed,
    y: Math.sin(state.pitch) * thrust * speed + climb * config.climbSpeed,
    z: (-cosYaw * cosPitch * thrust - sinYaw * sideThrust) * speed,
  };

  // Additional climb or diagonal input must not raise the total speed ceiling.
  const targetLength = Math.hypot(target.x, target.y, target.z);
  if (targetLength > speed) {
    const scale = speed / targetLength;
    target.x *= scale;
    target.y *= scale;
    target.z *= scale;
  }

  const activeThrust = Math.abs(forward) + Math.abs(strafe) + Math.abs(climb) > 0.001;
  const response = activeThrust ? config.response : config.brake;
  const decay = Math.exp(-response * time);
  const integral = (1 - decay) / response;

  // Analytic integration of exponential acceleration avoids frame-rate drift.
  for (const component of ['x', 'y', 'z'] as const) {
    const oldVelocity = state.velocity[component];
    state.position[component] += target[component] * time + (oldVelocity - target[component]) * integral;
    state.velocity[component] = target[component] + (oldVelocity - target[component]) * decay;
  }

  const targetRoll = clamp((-strafe * 0.8 + yawInput * 0.6) * config.bank, -0.45, 0.45);
  state.roll += (targetRoll - state.roll) * (1 - Math.exp(-7 * time));

  const terrain = groundHeight(state.position.x, state.position.z);
  const floor = (Number.isFinite(terrain) ? terrain : 0) + GROUND_CLEARANCE;
  if (state.position.y < floor) {
    state.position.y = floor;
    state.velocity.y = Math.min(1.2, Math.abs(Math.min(0, state.velocity.y)) * 0.18);
    state.velocity.x *= 0.65;
    state.velocity.z *= 0.65;
    state.collision = true;
  }

  return state;
}

/**
 * Tests a swept line against a ring, so a fast drone cannot skip a checkpoint.
 * Rings are passed only in their forward direction, within the circular opening.
 */
export function crossesCheckpoint(previous: Vec3, current: Vec3, checkpoint: Checkpoint): boolean {
  if (!Number.isFinite(checkpoint.radius) || checkpoint.radius <= 0) return false;
  const nx = -Math.sin(checkpoint.yaw);
  const nz = -Math.cos(checkpoint.yaw);
  const previousDistance = (previous.x - checkpoint.position.x) * nx + (previous.z - checkpoint.position.z) * nz;
  const currentDistance = (current.x - checkpoint.position.x) * nx + (current.z - checkpoint.position.z) * nz;
  const travel = currentDistance - previousDistance;
  if (previousDistance > 0 || currentDistance < 0 || travel <= 1e-9) return false;

  const fraction = -previousDistance / travel;
  const x = previous.x + (current.x - previous.x) * fraction - checkpoint.position.x;
  const y = previous.y + (current.y - previous.y) * fraction - checkpoint.position.y;
  const z = previous.z + (current.z - previous.z) * fraction - checkpoint.position.z;
  return x * x + y * y + z * z <= checkpoint.radius * checkpoint.radius;
}
