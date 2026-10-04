import assert from 'node:assert/strict';
import { stepFlight } from '../../src/game/flight.ts';
import type { FlightInput, FlightMode, FlightState, Vec3 } from '../../src/game/flight.ts';
import type { DroneProfile } from '../../src/game/drone-catalog.ts';
import { describeWind, sampleWind } from '../../src/game/wind.ts';
import type { WindSettings } from '../../src/game/wind.ts';
import type { Telemetry } from '../../src/game/types.ts';

export interface ReferenceBounds { minX: number; maxX: number; minZ: number; maxZ: number; maxAltitude: number }
export type SurfaceQuery = (x: number, z: number, fromY: number) => number;
export interface ReferenceResult {
  wind: Telemetry['wind'];
  windClock: number;
  boundaryContact: boolean;
  obstacleContact: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number) => Number.isFinite(value) ? value : 0;

/**
 * Independent migration oracle: the existing TS integrator plus the ordering
 * previously performed by FlightEngine. No WASM ABI or adapter helpers are used.
 */
export function stepReference(
  state: FlightState,
  input: FlightInput,
  dt: number,
  mode: FlightMode,
  profile: Readonly<DroneProfile>,
  settings: WindSettings,
  windClock: number,
  surface: SurfaceQuery,
  bounds?: ReferenceBounds,
  obstacleHit?: (position: Vec3) => boolean,
  windOverride?: Vec3,
): ReferenceResult {
  let boundaryContact = false, obstacleContact = false;
  if (Number.isFinite(dt) && dt > 0) {
    const time = Math.min(dt, 0.06);
    const previous = { ...state.position };
    const airflow = windOverride ?? sampleWind(settings, windClock + time * 0.5, previous);
    stepFlight(state, input, time, mode, (x, z) => surface(x, z, previous.y), profile, airflow);
    windClock += time;
    if (bounds) {
      const x = clamp(state.position.x, bounds.minX, bounds.maxX);
      const z = clamp(state.position.z, bounds.minZ, bounds.maxZ);
      const floor = finite(surface(x, z, previous.y)) + 1.8;
      const y = clamp(state.position.y, floor, Math.max(floor, bounds.maxAltitude));
      boundaryContact = x !== state.position.x || y !== state.position.y || z !== state.position.z;
      if (boundaryContact) {
        state.position = { x, y, z };
        state.velocity = { x: 0, y: 0, z: 0 };
      }
      obstacleContact = Boolean(obstacleHit?.(state.position));
      if (obstacleContact) {
        state.position = previous;
        state.velocity = { x: 0, y: 0, z: 0 };
      }
    }
  }
  const vector = windOverride
    ? { x: finite(windOverride.x), y: finite(windOverride.y), z: finite(windOverride.z) }
    : sampleWind(settings, windClock, state.position);
  return { wind: { ...describeWind(vector, state.yaw), vector }, windClock, boundaryContact, obstacleContact };
}

export function near(actual: number, expected: number, label: string, absoluteTolerance = 2e-8) {
  if (Object.is(actual, expected)) return;
  const tolerance = absoluteTolerance + Math.abs(expected) * 2e-12;
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance,
    `${label}: WASM ${actual}, TS ${expected}, tolerance ${tolerance}`);
}

export function assertStateClose(actual: FlightState, expected: FlightState, label: string, tolerance = 2e-8) {
  for (const field of ['position', 'velocity'] as const) for (const axis of ['x', 'y', 'z'] as const) {
    near(actual[field][axis], expected[field][axis], `${label}.${field}.${axis}`, tolerance);
  }
  for (const field of ['yaw', 'pitch', 'roll'] as const) near(actual[field], expected[field], `${label}.${field}`, tolerance);
  assert.equal(Boolean(actual.collision), Boolean(expected.collision), `${label}.collision`);
}

export function assertResultClose(actual: ReferenceResult, expected: ReferenceResult, label: string) {
  near(actual.windClock, expected.windClock, `${label}.windClock`);
  assert.equal(actual.boundaryContact, expected.boundaryContact, `${label}.boundaryContact`);
  assert.equal(actual.obstacleContact, expected.obstacleContact, `${label}.obstacleContact`);
  for (const axis of ['x', 'y', 'z'] as const) near(actual.wind.vector[axis], expected.wind.vector[axis], `${label}.wind.vector.${axis}`);
  for (const field of ['speed', 'headwind', 'crosswind'] as const) near(actual.wind[field], expected.wind[field], `${label}.wind.${field}`);
  // Wind bearing is circular, so 0 and 360 describe the same physical direction.
  const angleDifference = ((actual.wind.fromDegrees - expected.wind.fromDegrees + 180) % 360 + 360) % 360 - 180;
  near(angleDifference, 0, `${label}.wind.fromDegrees`);
  assert.equal(actual.wind.directionLabel, expected.wind.directionLabel, `${label}.wind.directionLabel`);
  assert.equal(actual.wind.relativeLabel, expected.wind.relativeLabel, `${label}.wind.relativeLabel`);
}
