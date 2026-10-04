import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WIND_SETTINGS, WIND_PRESETS, describeWind, sampleWind } from '../src/game/wind.ts';
import type { WindSettings } from '../src/game/wind.ts';
import { createFlightState, stepFlight } from '../src/game/flight.ts';
import type { FlightInput, FlightMode, FlightState, Vec3 } from '../src/game/flight.ts';
import { DRONES, getDroneSpec, getFlightConfig } from '../src/game/drone-catalog.ts';
import type { DroneId } from '../src/game/drone-catalog.ts';

const origin: Vec3 = { x: 0, y: 0, z: 0 };
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const idle: FlightInput = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
const forward: FlightInput = { ...idle, forward: 1 };
const modes: FlightMode[] = ['assisted', 'sport'];
const near = (actual: number, expected: number, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const angleDifference = (actual: number, expected: number) => ((actual - expected + 540) % 360) - 180;

function run(id: DroneId, mode: FlightMode, input: FlightInput, wind: Vec3, seconds = 10, fps = 60, state = createFlightState()): FlightState {
  for (let frame = 0; frame < seconds * fps; frame++) stepFlight(state, input, 1 / fps, mode, () => 0, getDroneSpec(id).flight, wind);
  return state;
}

test('meteorological directions push the aircraft away from their origin and describe all eight relative sectors', () => {
  assert.deepEqual(DEFAULT_WIND_SETTINGS, { strength: 'breeze', direction: 315 });
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
  const compass = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const relative = ['迎风', '右前侧风', '右侧风', '右后侧风', '顺风', '左后侧风', '左侧风', '左前侧风'];
  bearings.forEach((direction, index) => {
    const wind = sampleWind({ strength: 'windy', direction }, 0, origin);
    const rad = direction * Math.PI / 180;
    near(wind.x, -Math.sin(rad) * 6 * 0.78);
    near(wind.z, Math.cos(rad) * 6 * 0.78);
    const info = describeWind(wind, 0);
    near(info.fromDegrees, direction);
    assert.equal(info.directionLabel, compass[index]);
    assert.equal(info.relativeLabel, relative[index]);
    near(info.headwind, wind.z);
    near(info.crosswind, -wind.x);
    near(info.speed, Math.hypot(wind.x, wind.y, wind.z));
  });
});

test('headwind and crosswind projections follow the aircraft heading with the right signs', () => {
  const northerly = { x: 0, y: 0, z: 6 };
  const easterly = { x: -6, y: 0, z: 0 };
  const westerly = { x: 6, y: 0, z: 0 };
  assert.equal(describeWind(northerly, 0).relativeLabel, '迎风');
  assert.equal(describeWind(easterly, 0).relativeLabel, '右侧风');
  const facingWest = describeWind(northerly, Math.PI / 2);
  near(facingWest.headwind, 0);
  near(facingWest.crosswind, 6);
  assert.equal(facingWest.relativeLabel, '右侧风');
  near(describeWind(westerly, Math.PI / 2).headwind, 6);
  near(describeWind(easterly, Math.PI / 2).headwind, -6);
  assert.equal(describeWind(easterly, Math.PI / 2).relativeLabel, '顺风');
  const facingNorthwest = describeWind(sampleWind(DEFAULT_WIND_SETTINGS, 0, origin), Math.PI / 4);
  assert.equal(facingNorthwest.relativeLabel, '迎风');
  near(facingNorthwest.crosswind, 0);
});

test('natural wind starts on the selected bearing then meanders smoothly within forty degrees', () => {
  const positions = [origin, { x: 0, y: 12, z: 55 }, { x: 1500, y: 200, z: -400 }];
  for (const strength of ['breeze', 'windy', 'strong'] as const) for (const position of positions) {
    for (const direction of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const initial = describeWind(sampleWind({ strength, direction }, 0, position), 0);
      near(angleDifference(initial.fromDegrees, direction), 0);
    }
    const settings = { strength, direction: 315 };
    let previous = 315;
    for (let frame = 0; frame <= 120 * 20; frame++) {
      const bearing = describeWind(sampleWind(settings, frame / 20, position), 0).fromDegrees;
      assert.ok(Math.abs(angleDifference(bearing, settings.direction)) <= 40 + 1e-8);
      // At a fixed position the analytic derivative is bounded by 6.67 deg/s.
      assert.ok(Math.abs(angleDifference(bearing, previous)) <= 0.334);
      previous = bearing;
    }
  }
  const settings = { strength: 'breeze', direction: 315 } as const;
  const offsets = Array.from({ length: 121 }, (_, time) => angleDifference(describeWind(sampleWind(settings, time, positions[1]), 0).fromDegrees, 315));
  assert.ok(Math.min(...offsets) < -20 && Math.max(...offsets) > 20, 'direction changes must be perceptible in both directions');
  const bearing = (time: number, position: Vec3) => describeWind(sampleWind(settings, time, position), 0).fromDegrees;
  assert.ok(Math.abs(angleDifference(bearing(12, positions[1]), bearing(12, positions[2]))) > 1, 'horizontal position also affects weather phase');
  near(angleDifference(bearing(12, { ...positions[1], y: 0 }), bearing(12, { ...positions[1], y: 300 })), 0);
});

test('wind gusts are deterministic, smooth, spatially varied and stronger above sheltered ground', () => {
  const settings: WindSettings = { strength: 'strong', direction: 315 };
  const position = { x: 125, y: 20, z: -310 };
  const sample = sampleWind(settings, 12.3, position);
  assert.deepEqual(sample, sampleWind({ ...settings }, 12.3, { ...position }));
  assert.notDeepEqual(sample, sampleWind(settings, 15, position));
  assert.notDeepEqual(sample, sampleWind(settings, 12.3, { ...position, x: position.x + 120 }));
  const later = sampleWind(settings, 12.301, position);
  assert.ok(Math.hypot(later.x - sample.x, later.y - sample.y, later.z - sample.z) < 0.004);
  const nearby = sampleWind(settings, 12.3, { ...position, x: position.x + 0.01, y: position.y + 0.01 });
  assert.ok(Math.hypot(nearby.x - sample.x, nearby.y - sample.y, nearby.z - sample.z) < 0.002);
  const low = sampleWind(settings, 12.3, { ...position, y: 0 });
  const high = sampleWind(settings, 12.3, { ...position, y: 250 });
  assert.ok(Math.hypot(high.x, high.z) > Math.hypot(low.x, low.z));
  const breeze = sampleWind({ ...settings, strength: 'breeze' }, 12.3, position);
  near(Math.hypot(sample.x, sample.z) / Math.hypot(breeze.x, breeze.z), WIND_PRESETS.strong.baseSpeed / WIND_PRESETS.breeze.baseSpeed);
  assert.deepEqual(sampleWind({ strength: 'windy', direction: 450 }, 1, position), sampleWind({ strength: 'windy', direction: 90 }, 1, position));
});

test('headwinds reduce ground speed and tailwinds raise it for every profile and both modes', () => {
  for (const spec of DRONES) for (const mode of modes) {
    const calm = run(spec.id, mode, forward, zero);
    const head = run(spec.id, mode, forward, { x: 0, y: 0, z: 6 });
    const tail = run(spec.id, mode, forward, { x: 0, y: 0, z: -6 });
    const gain = mode === 'assisted' ? 0.35 : 0.85;
    assert.ok(-head.velocity.z < -calm.velocity.z, `${spec.id}/${mode} headwind must reduce progress`);
    assert.ok(-tail.velocity.z > -calm.velocity.z, `${spec.id}/${mode} tailwind must increase progress`);
    near(-calm.velocity.z, getFlightConfig(spec.id, mode).speed, 1e-6);
    near(calm.velocity.z - head.velocity.z, -6 * gain, 1e-6);
    near(calm.velocity.z - tail.velocity.z, 6 * gain, 1e-6);
  }
});

test('sport has stronger side drift, side wind banks slightly, and ordinary controls can correct it', () => {
  const sidewind = { x: 6, y: 0, z: 0 };
  const assisted = run('freestyle', 'assisted', idle, sidewind);
  const sport = run('freestyle', 'sport', idle, sidewind);
  assert.ok(assisted.position.x > 0 && sport.position.x > assisted.position.x);
  assert.ok(sport.velocity.x > assisted.velocity.x);
  assert.ok(assisted.roll > 0 && assisted.roll < 0.1);
  assert.equal(assisted.pitch, 0);
  const quick = run('racer', 'sport', idle, sidewind, 0.2);
  const heavy = run('explorer', 'sport', idle, sidewind, 0.2);
  assert.ok(quick.velocity.x > heavy.velocity.x, 'profile response still affects how drift develops');
  for (const spec of DRONES) for (const mode of modes) {
    const gain = mode === 'assisted' ? 0.35 : 0.85;
    const correction = -6 * gain / getFlightConfig(spec.id, mode).speed;
    const fixed = run(spec.id, mode, { ...forward, forward: 0.7, strafe: correction }, sidewind);
    near(fixed.position.x, 0);
    near(fixed.velocity.x, 0);
    assert.ok(fixed.position.z < 55, 'wind correction should still permit forward flight');
    const west = run(spec.id, mode, { ...forward, forward: 0.7, strafe: correction }, { x: 0, y: 0, z: -6 }, 10, 60, createFlightState(undefined, Math.PI / 2));
    near(west.position.z, 55);
    assert.ok(west.position.x < 0, 'the same local correction follows aircraft yaw');
  }
});

test('constant wind flight remains stable at 30, 60 and 120 frames per second', () => {
  for (const mode of modes) for (const id of ['cinewhoop', 'explorer', 'falcon'] as const) {
    const frames = [30, 60, 120].map(fps => run(id, mode, { ...forward, strafe: 0.3 }, { x: -6, y: 0.2, z: 3 }, 4, fps));
    for (const state of frames.slice(1)) {
      for (const axis of ['x', 'y', 'z'] as const) {
        near(state.position[axis], frames[0].position[axis]);
        near(state.velocity[axis], frames[0].velocity[axis]);
      }
      near(state.roll, frames[0].roll);
      assert.equal(state.pitch, frames[0].pitch);
    }
  }
});

test('a full directional weather cycle at 30, 60 and 120 fps keeps accumulated travel within centimetres', () => {
  const states = [30, 60, 120].map(fps => {
    const state = createFlightState();
    for (let frame = 0; frame < 64 * fps; frame++) {
      const wind = sampleWind({ strength: 'strong', direction: 315 }, (frame + 0.5) / fps, state.position);
      stepFlight(state, forward, 1 / fps, 'sport', () => 0, getDroneSpec('freestyle').flight, wind);
    }
    return state;
  });
  for (const state of states.slice(1)) for (const axis of ['x', 'y', 'z'] as const) {
    near(state.position[axis], states[0].position[axis], 0.03);
    near(state.velocity[axis], states[0].velocity[axis], 0.01);
  }
});

test('no wind is exact-compatible with existing simulation, including omitted arguments and all profiles', () => {
  for (const spec of DRONES) {
    const original = createFlightState(), explicit = createFlightState();
    for (let frame = 0; frame < 180; frame++) {
      const input = { forward: frame < 70 ? 1 : 0, strafe: frame >= 90 && frame < 120 ? 0.2 : 0, climb: 0.1, yaw: frame < 30 ? 0.3 : 0, lookPitch: frame >= 40 && frame < 50 ? 0.2 : 0 };
      const mode = frame < 90 ? 'assisted' : 'sport';
      stepFlight(original, input, 1 / 60, mode, () => 0, spec.flight);
      stepFlight(explicit, input, 1 / 60, mode, () => 0, spec.flight, zero);
    }
    assert.deepEqual(explicit, original);
  }
  assert.deepEqual(sampleWind({ strength: 'calm', direction: 45 }, 123, { x: 55, y: 400, z: -500 }), zero);
  assert.equal(describeWind(zero, 1).relativeLabel, '无风');
});

test('invalid settings, coordinates, wind components and paused time cannot poison flight state', () => {
  for (const strength of ['unknown', '__proto__', 'constructor']) assert.deepEqual(sampleWind({ strength, direction: 0 } as WindSettings, 0, origin), zero);
  for (const direction of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.deepEqual(sampleWind({ strength: 'strong', direction }, 0, origin), zero);
  const settings: WindSettings = { strength: 'windy', direction: 0 };
  const invalid = { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  assert.deepEqual(sampleWind(settings, Number.NaN, invalid), sampleWind(settings, 0, origin));
  assert.deepEqual(sampleWind(settings, -1, origin), sampleWind(settings, 0, origin));
  assert.deepEqual(describeWind(invalid, Number.NaN), describeWind(zero, 0));
  const state = createFlightState(), calm = createFlightState();
  stepFlight(state, forward, 1 / 60, 'assisted', () => 0, getDroneSpec('freestyle').flight, invalid);
  stepFlight(calm, forward, 1 / 60);
  assert.deepEqual(state, calm);
  const before = structuredClone(state);
  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) stepFlight(state, forward, dt, 'sport', () => 0, getDroneSpec('freestyle').flight, { x: 6, y: 0, z: 2 });
  assert.deepEqual(state, before);
  stepFlight(state, idle, 0.05, 'assisted', () => 0, getDroneSpec('freestyle').flight, { x: Number.MAX_VALUE, y: 0, z: 0 });
  assert.ok(Object.values(state.position).every(Number.isFinite));
  assert.ok(Object.values(state.velocity).every(Number.isFinite));
  assert.ok(state.position.x < 1, 'external extreme winds stay bounded in a single frame');
});
