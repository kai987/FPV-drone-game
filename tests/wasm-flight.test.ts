import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createFlightState, crossesCheckpoint } from '../src/game/flight.ts';
import type { FlightInput, FlightMode, FlightState, Vec3 } from '../src/game/flight.ts';
import { DRONES, getDroneSpec, getFlightConfig } from '../src/game/drone-catalog.ts';
import { createFlightSimulation } from '../src/game/flight-simulation.ts';
import { LAKES, WATER_LEVEL, WORLD_BOUNDS, surfaceHeight } from '../src/game/landscape.ts';
import { BRIDGES } from '../src/game/rural-layout.ts';
import { flightSurfaceHeight } from '../src/game/surfaces.ts';
import { CHECKPOINTS } from '../src/game/world.ts';
import type { WindSettings } from '../src/game/wind.ts';
import { assertResultClose, assertStateClose, near, stepReference } from './helpers/flight-reference.ts';
import type { SurfaceQuery } from './helpers/flight-reference.ts';
import { courseControls } from './helpers/course-controller.ts';

// Compile the emitted Rust artifact, never a JS stand-in or a mocked WASM API.
// Missing/invalid artifacts fail the suite rather than silently skipping it.
const wasmBytes = await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url));
const wasmModule = await WebAssembly.compile(wasmBytes);
const flatGround: SurfaceQuery = () => 0;
const idle: FlightInput = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
const forward: FlightInput = { ...idle, forward: 1 };
const calm: WindSettings = { strength: 'calm', direction: 0 };
const modes: readonly FlightMode[] = ['assisted', 'sport'];
const strengths = ['calm', 'breeze', 'windy', 'strong'] as const;
const bearings = [0, 45, 90, 135, 180, 225, 270, 315];
const frameRates = [30, 60, 120];

function controlsAt(time: number): FlightInput {
  if (time < 0.35) return { forward: 1, strafe: 0.25, climb: 0.1, yaw: 0.2, lookPitch: 0.12 };
  if (time < 0.65) return { forward: 0.6, strafe: -0.35, climb: -0.2, yaw: -0.4, lookPitch: -0.15 };
  if (time < 1) return { ...idle, yaw: 0.2 };
  return { forward: 2, strafe: 1.5, climb: 2, yaw: 2, lookPitch: 1, boost: true };
}

test('real WASM matches TS for six aircraft, both modes, four wind strengths, eight bearings and three frame rates', () => {
  for (const spec of DRONES) for (const mode of modes) {
    const simulation = createFlightSimulation(wasmModule, flatGround);
    try {
      for (const strength of strengths) for (const direction of bearings) for (const fps of frameRates) {
        const settings: WindSettings = { strength, direction };
        const expected = createFlightState({ x: 125, y: 75, z: -310 }, direction * Math.PI / 180 + 0.27);
        expected.pitch = -0.15; expected.roll = 0.08; expected.velocity = { x: 3, y: -0.2, z: -2 };
        const actual = structuredClone(expected);
        let clock = 12.3;
        const label = `${spec.id}/${mode}/${strength}/${direction}/${fps}fps`;
        for (let frame = 0; frame < 1.5 * fps; frame++) {
          const input = controlsAt(frame / fps);
          const expectedResult = stepReference(expected, input, 1 / fps, mode, spec.flight, settings, clock, flatGround);
          const result = simulation.step(actual, input, 1 / fps, mode, spec.flight, settings, clock);
          assertStateClose(actual, expected, `${label}/frame${frame}`);
          assertResultClose(result, expectedResult, `${label}/frame${frame}`);
          clock = expectedResult.windClock;
        }
      }
    } finally { simulation.dispose(); }
  }
});

test('explicit constant wind overrides dynamic weather and remains frame-rate independent in WASM', () => {
  const wind = { x: -6, y: 0.2, z: 3 };
  const settings: WindSettings = { strength: 'strong', direction: 315 };
  const input = { ...forward, forward: 0.73, strafe: 0.26, climb: 0.05 };
  for (const spec of DRONES) for (const mode of modes) {
    const endpoints: FlightState[] = [];
    const simulation = createFlightSimulation(wasmModule, flatGround);
    try {
      for (const fps of frameRates) {
        const expected = createFlightState({ x: 0, y: 80, z: 55 }, 0.4); expected.pitch = 0.22;
        const actual = structuredClone(expected);
        let clock = 32;
        for (let frame = 0; frame < 4 * fps; frame++) {
          const expectedResult = stepReference(expected, input, 1 / fps, mode, spec.flight, settings, clock, flatGround, undefined, undefined, wind);
          const result = simulation.step(actual, input, 1 / fps, mode, spec.flight, settings, clock, undefined, wind);
          clock = result.windClock;
          assertResultClose(result, expectedResult, `${spec.id}/${mode}/${fps}fps`);
        }
        assertStateClose(actual, expected, `${spec.id}/${mode}/${fps}fps`);
        endpoints.push(actual);
      }
      for (const endpoint of endpoints.slice(1)) assertStateClose(endpoint, endpoints[0], `${spec.id}/${mode}/frame-rate invariance`);
    } finally { simulation.dispose(); }
  }
});

test('real WASM wind bearings match TS over a weather cycle and pause/reset repeat the same field', () => {
  const profile = getDroneSpec('freestyle').flight;
  const simulation = createFlightSimulation(wasmModule, flatGround);
  const difference = (actual: number, expected: number) => ((actual - expected + 540) % 360) - 180;
  try {
    for (const direction of [0, 315, -45, 765]) for (const position of [
      { x: 0, y: 12, z: 55 }, { x: 1500, y: 200, z: -400 },
    ]) {
      const settings: WindSettings = { strength: 'strong', direction };
      const state = createFlightState(position, 0.7);
      const before = structuredClone(state);
      const baseline = ((direction % 360) + 360) % 360;
      const initial = simulation.step(state, idle, 0, 'sport', profile, settings, 0);
      near(difference(initial.wind.fromDegrees, baseline), 0, 'selected initial bearing');
      let greatestOffset = 0;
      for (const elapsed of [0, 6, 12, 20, 32, 50, 64, 80, 120]) {
        const expected = stepReference(structuredClone(before), idle, 0, 'sport', profile, settings, elapsed, flatGround);
        const actual = simulation.step(state, idle, 0, 'sport', profile, settings, elapsed);
        assertResultClose(actual, expected, `bearing ${direction}, clock ${elapsed}`);
        assert.deepEqual(state, before, 'sampling paused telemetry must not move the aircraft');
        assert.deepEqual(simulation.step(state, idle, 0, 'sport', profile, settings, elapsed), actual,
          'the same frozen clock and position reproduce wind telemetry');
        const offset = Math.abs(difference(actual.wind.fromDegrees, baseline));
        assert.ok(offset <= 40 + 1e-10, 'weather remains near the selected baseline');
        greatestOffset = Math.max(greatestOffset, offset);
      }
      assert.ok(greatestOffset > 20, 'WASM must change the actual horizontal wind vector appreciably');
      assert.deepEqual(simulation.step(state, idle, 0, 'sport', profile, settings, 0), initial,
        'resetting the clock reproduces the selected initial wind');
    }
  } finally { simulation.dispose(); }
});

test('a full directional weather cycle matches TS in WASM with centimetre-level frame-rate stability', () => {
  const profile = getDroneSpec('freestyle').flight;
  const settings: WindSettings = { strength: 'strong', direction: 315 };
  const simulation = createFlightSimulation(wasmModule, flatGround);
  try {
    for (const mode of modes) {
      const endpoints: FlightState[] = [];
      for (const fps of frameRates) {
        const expected = createFlightState(), actual = structuredClone(expected);
        let clock = 0;
        for (let frame = 0; frame < 64 * fps; frame++) {
          const expectedResult = stepReference(expected, forward, 1 / fps, mode, profile, settings, clock, flatGround);
          const result = simulation.step(actual, forward, 1 / fps, mode, profile, settings, clock);
          assertStateClose(actual, expected, `${mode}/${fps}fps/frame${frame}`);
          assertResultClose(result, expectedResult, `${mode}/${fps}fps/frame${frame}`);
          clock = result.windClock;
        }
        near(clock, 64, `${mode}/${fps}fps weather clock`);
        endpoints.push(actual);
      }
      for (const endpoint of endpoints.slice(1)) {
        for (const axis of ['x', 'y', 'z'] as const) {
          near(endpoint.position[axis], endpoints[0].position[axis], `${mode}/frame-rate position.${axis}`, 0.03);
          near(endpoint.velocity[axis], endpoints[0].velocity[axis], `${mode}/frame-rate velocity.${axis}`, 0.01);
        }
      }
    }
  } finally { simulation.dispose(); }
});

test('paused or invalid dt preserves state and clock without terrain/obstacle queries but refreshes wind telemetry', () => {
  let terrainQueries = 0, obstacleQueries = 0;
  const simulation = createFlightSimulation(wasmModule, () => { terrainQueries++; return 0; }, () => { obstacleQueries++; return true; });
  const profile = getDroneSpec('falcon').flight;
  try {
    const actual = createFlightState({ x: 37, y: 19, z: -91 }, 1.7);
    actual.velocity = { x: 5, y: -2, z: 8 }; actual.pitch = 0.31; actual.roll = -0.2; actual.collision = true;
    const before = structuredClone(actual);
    for (const dt of [0, -1, Number.NaN, Infinity, -Infinity]) for (const direction of [0, 135, 315]) {
      const settings: WindSettings = { strength: 'strong', direction };
      const expected = stepReference(structuredClone(before), forward, dt, 'sport', profile, settings, 17.25, flatGround, WORLD_BOUNDS);
      const result = simulation.step(actual, forward, dt, 'sport', profile, settings, 17.25, WORLD_BOUNDS);
      assert.deepEqual(actual, before);
      assertResultClose(result, expected, `paused dt=${dt}, direction=${direction}`);
    }
    const withoutCollision = createFlightState(); delete withoutCollision.collision;
    const unchanged = structuredClone(withoutCollision);
    simulation.step(withoutCollision, forward, 0, 'sport', profile, calm, 0, WORLD_BOUNDS);
    assert.deepEqual(withoutCollision, unchanged, 'paused updates retain an absent optional collision field');
    assert.equal(terrainQueries, 0); assert.equal(obstacleQueries, 0);
  } finally { simulation.dispose(); }
});

test('large dt advances physics and wind clock by the same capped timestep', () => {
  const profile = getDroneSpec('vector').flight;
  const settings: WindSettings = { strength: 'strong', direction: 315 };
  const simulation = createFlightSimulation(wasmModule, flatGround);
  try {
    for (const dt of [0.06, 0.5, 100]) {
      const actual = createFlightState(), expected = createFlightState();
      const expectedResult = stepReference(expected, forward, dt, 'sport', profile, settings, 9.75, flatGround);
      const result = simulation.step(actual, forward, dt, 'sport', profile, settings, 9.75);
      assertStateClose(actual, expected, `dt=${dt}`); assertResultClose(result, expectedResult, `dt=${dt}`);
      near(result.windClock, 9.81, `dt=${dt} clamped clock`);
    }
  } finally { simulation.dispose(); }
});

test('real terrain, lake and bridge support use previous altitude across the WASM boundary', () => {
  const bridge = BRIDGES[0], lake = LAKES[0];
  const spots = [
    { name: 'terrain', x: 0, z: 55, y: surfaceHeight(0, 55) + 12, support: surfaceHeight(0, 55) },
    { name: 'lake', x: lake.x, z: lake.z, y: 12, support: WATER_LEVEL },
    { name: 'above bridge', x: bridge.x, z: bridge.z, y: bridge.deckY + 12, support: bridge.deckY },
    { name: 'under bridge', x: bridge.x, z: bridge.z, y: bridge.deckY - 0.2, support: surfaceHeight(bridge.x, bridge.z) },
  ];
  const requests: Array<{ x: number; z: number; fromY: number }> = [];
  const simulation = createFlightSimulation(wasmModule, (x, z, fromY) => {
    requests.push({ x, z, fromY }); return flightSurfaceHeight(x, z, fromY);
  });
  const profile = getDroneSpec('freestyle').flight;
  try {
    for (const spot of spots) {
      const position = { x: spot.x, y: spot.y, z: spot.z };
      const actual = createFlightState(position), expected = createFlightState(position);
      let clock = 0;
      for (let frame = 0; frame < 240; frame++) {
        requests.length = 0;
        const previousY = actual.position.y;
        const input = { ...idle, climb: -1 };
        const expectedResult = stepReference(expected, input, 1 / 60, 'assisted', profile, calm, clock, flightSurfaceHeight);
        const result = simulation.step(actual, input, 1 / 60, 'assisted', profile, calm, clock);
        assert.equal(requests.length, 1, `${spot.name}: one terrain query after integration`);
        assert.equal(requests[0].fromY, previousY, `${spot.name}: terrain selection must use altitude before the step`);
        near(requests[0].x, expected.position.x, `${spot.name}: new query x`);
        near(requests[0].z, expected.position.z, `${spot.name}: new query z`);
        assertStateClose(actual, expected, `${spot.name}/${frame}`); assertResultClose(result, expectedResult, `${spot.name}/${frame}`);
        clock = result.windClock;
      }
      near(actual.position.y, spot.support + 1.8, `${spot.name}: final support clearance`, 0.02);
      if (spot.name === 'under bridge') assert.ok(actual.position.y < bridge.deckY, 'WASM must not teleport a drone from the river to the bridge deck');
    }
  } finally { simulation.dispose(); }
});

test('external mouse attitude changes and resets are read from the authoritative JS state each frame', () => {
  const profile = getDroneSpec('racer').flight;
  const settings: WindSettings = { strength: 'windy', direction: 90 };
  const simulation = createFlightSimulation(wasmModule, flatGround);
  try {
    const actual = createFlightState({ x: 0, y: 60, z: 0 }), expected = structuredClone(actual);
    let clock = 0;
    for (let frame = 0; frame < 180; frame++) {
      if (frame === 37) for (const state of [actual, expected]) { state.yaw = Math.PI * 7 + 0.12; state.pitch = 0.68; state.roll = -0.33; }
      if (frame === 80) for (const state of [actual, expected]) { state.yaw = -Math.PI * 5 - 0.05; state.pitch = -0.68; }
      if (frame === 120) {
        Object.assign(actual, createFlightState({ x: 480, y: 90, z: -400 }, -1.2));
        Object.assign(expected, structuredClone(actual)); clock = 0;
      }
      const input = { ...forward, strafe: 0.2, yaw: frame > 80 ? -0.4 : 0.3, lookPitch: frame < 80 ? 0.2 : -0.1 };
      const expectedResult = stepReference(expected, input, 1 / 60, 'sport', profile, settings, clock, flatGround);
      const result = simulation.step(actual, input, 1 / 60, 'sport', profile, settings, clock);
      assertStateClose(actual, expected, `mouse/reset frame${frame}`); assertResultClose(result, expectedResult, `mouse/reset frame${frame}`);
      clock = result.windClock;
    }
  } finally { simulation.dispose(); }
});

test('bounds and obstacle rollback occur before final wind sampling, with obstacle queries disabled unless bounds are supplied', () => {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10, maxAltitude: 50 };
  const settings: WindSettings = { strength: 'strong', direction: 225 };
  const profile = getDroneSpec('falcon').flight;
  const scenarios = [
    { name: 'x boundary', position: { x: 9.8, y: 15, z: 0 }, velocity: { x: 95, y: 0, z: 0 }, surface: flatGround, obstacle: false, enabled: true },
    { name: 'ceiling', position: { x: 0, y: 49.9, z: 0 }, velocity: { x: 0, y: 80, z: 0 }, surface: flatGround, obstacle: false, enabled: true },
    { name: 'terrain higher than ceiling', position: { x: 9.8, y: 15, z: 0 }, velocity: { x: 95, y: 0, z: 0 }, surface: (x: number) => x >= 10 ? 80 : 0, obstacle: false, enabled: true },
    { name: 'obstacle after boundary', position: { x: 9.8, y: 15, z: 0 }, velocity: { x: 95, y: 0, z: 0 }, surface: flatGround, obstacle: true, enabled: true },
    { name: 'unbounded free step', position: { x: 9.8, y: 15, z: 0 }, velocity: { x: 95, y: 0, z: 0 }, surface: flatGround, obstacle: true, enabled: false },
  ];
  for (const scenario of scenarios) {
    const calls: Vec3[] = [];
    const heights: number[] = [];
    const simulation = createFlightSimulation(wasmModule, (x, z, fromY) => {
      heights.push(fromY); return scenario.surface(x, z, fromY);
    }, position => { calls.push({ ...position }); return scenario.obstacle; });
    try {
      const actual = createFlightState(scenario.position); actual.velocity = { ...scenario.velocity };
      const expected = structuredClone(actual);
      const limits = scenario.enabled ? bounds : undefined;
      const input = { ...idle, strafe: 1, climb: 0.2, yaw: 0.3 };
      const expectedResult = stepReference(expected, input, 0.06, 'sport', profile, settings, 11.4, scenario.surface, limits, () => scenario.obstacle);
      const result = simulation.step(actual, input, 0.06, 'sport', profile, settings, 11.4, limits);
      assertStateClose(actual, expected, scenario.name); assertResultClose(result, expectedResult, scenario.name);
      assert.ok(heights.every(y => y === scenario.position.y), `${scenario.name}: both support queries retain previous altitude`);
      assert.equal(calls.length, scenario.enabled ? 1 : 0);
      if (scenario.name === 'obstacle after boundary') {
        assert.equal(calls[0].x, 10, 'collision query must see the clamped position');
        assert.deepEqual(actual.position, scenario.position, 'an obstacle rolls back position');
        assert.deepEqual(actual.velocity, { x: 0, y: 0, z: 0 });
        assert.equal(result.boundaryContact, true); assert.equal(result.obstacleContact, true);
      }
      if (scenario.name === 'terrain higher than ceiling') assert.equal(actual.position.y, 81.8);
    } finally { simulation.dispose(); }
  }
});

test('invalid controls, settings, terrain and wind components retain TS sanitization through the binary ABI', () => {
  const profile = getDroneSpec('explorer').flight;
  const cases: Array<{ settings: WindSettings; wind?: Vec3; terrain: number }> = [
    { settings: { strength: 'strong', direction: NaN }, terrain: 0 },
    { settings: { strength: 'windy', direction: Infinity }, terrain: 0 },
    { settings: { strength: '__proto__', direction: 90 } as WindSettings, terrain: 0 },
    { settings: { strength: 'windy', direction: -630 }, terrain: NaN },
    { settings: calm, wind: { x: NaN, y: Infinity, z: -Infinity }, terrain: 0 },
    { settings: calm, wind: { x: 1e300, y: 0, z: -1e300 }, terrain: 0 },
    { settings: calm, wind: { x: 0, y: 4, z: 0 }, terrain: 0 },
  ];
  for (const [index, scenario] of cases.entries()) {
    const surface = () => scenario.terrain;
    const simulation = createFlightSimulation(wasmModule, surface);
    try {
      const actual = createFlightState({ x: 0, y: 1, z: 0 }), expected = structuredClone(actual);
      const input = { forward: NaN, strafe: Infinity, climb: -3, yaw: -Infinity, lookPitch: NaN, boost: true };
      const expectedResult = stepReference(expected, input, 0.05, 'sport', profile, scenario.settings, 3, surface, undefined, undefined, scenario.wind);
      const result = simulation.step(actual, input, 0.05, 'sport', profile, scenario.settings, 3, undefined, scenario.wind);
      assertStateClose(actual, expected, `invalid inputs ${index}`); assertResultClose(result, expectedResult, `invalid inputs ${index}`);
      assert.ok(Object.values(actual.position).every(Number.isFinite));
      assert.ok(Object.values(actual.velocity).every(Number.isFinite));
    } finally { simulation.dispose(); }
  }
});

test('repeated WASM creation and disposal cannot corrupt another live simulation or previous results', () => {
  const settings: WindSettings = { strength: 'strong', direction: 270 };
  const profile = getDroneSpec('freestyle').flight;
  const survivor = createFlightSimulation(wasmModule, flatGround);
  const actual = createFlightState({ x: 600, y: 40, z: -600 }), expected = structuredClone(actual);
  let clock = 0;
  try {
    for (let cycle = 0; cycle < 32; cycle++) {
      const temporary = createFlightSimulation(wasmModule, flatGround);
      const separate = createFlightState({ x: -600, y: 20, z: 300 });
      const initial = temporary.step(separate, forward, 0.05, 'assisted', profile, calm, 0);
      const snapshot = structuredClone(initial);
      temporary.step(separate, { ...idle, strafe: 1 }, 0.05, 'sport', profile, settings, initial.windClock);
      assert.deepEqual(initial, snapshot, 'returned telemetry must not alias the reusable WASM buffer');
      temporary.dispose(); temporary.dispose();
      const expectedResult = stepReference(expected, forward, 0.05, 'sport', profile, settings, clock, flatGround);
      const result = survivor.step(actual, forward, 0.05, 'sport', profile, settings, clock);
      assertStateClose(actual, expected, `surviving instance ${cycle}`); assertResultClose(result, expectedResult, `surviving instance ${cycle}`);
      clock = result.windClock;
    }
  } finally { survivor.dispose(); survivor.dispose(); }
});

test('terrain callbacks cannot reenter or free an active WASM tick, and the instance remains usable', () => {
  const profile = getDroneSpec('freestyle').flight;
  const settings: WindSettings = { strength: 'breeze', direction: 315 };
  let callbackEntries = 0;
  const nestedState = createFlightState();
  const nestedBefore = structuredClone(nestedState);
  const simulation = createFlightSimulation(wasmModule, () => {
    callbackEntries++;
    assert.throws(() => simulation.step(nestedState, forward, 0.05, 'sport', profile, settings, 0), /cannot reenter a tick/);
    assert.throws(() => simulation.dispose(), /cannot be disposed during a tick/);
    return 0;
  });
  const actual = createFlightState(), expected = createFlightState();
  let clock = 0;
  try {
    for (let step = 0; step < 3; step++) {
      const expectedResult = stepReference(expected, forward, 0.05, 'sport', profile, settings, clock, flatGround);
      const result = simulation.step(actual, forward, 0.05, 'sport', profile, settings, clock);
      assertStateClose(actual, expected, `protected tick ${step}`); assertResultClose(result, expectedResult, `protected tick ${step}`);
      clock = result.windClock;
    }
    assert.equal(callbackEntries, 3);
    assert.deepEqual(nestedState, nestedBefore, 'rejected nested ticks cannot mutate the caller state');
  } finally { simulation.dispose(); simulation.dispose(); }
  assert.throws(() => simulation.step(actual, idle, 0.01, 'sport', profile, settings, clock), /has been disposed/);
});

test('all six aircraft finish the real eight-gate course in both modes using WASM and ordinary flight controls', () => {
  assert.equal(CHECKPOINTS.length, 8);
  for (const spec of DRONES) for (const mode of modes) {
    const simulation = createFlightSimulation(wasmModule, flightSurfaceHeight);
    const state = createFlightState();
    const passed: number[] = [];
    const maxSpeed = getFlightConfig(spec.id, mode).speed;
    let clock = 0, contacts = 0;
    try {
      for (let frame = 0; frame < 120 * 60 && passed.length < CHECKPOINTS.length; frame++) {
        const checkpoint = CHECKPOINTS[passed.length];
        const previous = { ...state.position };
        const input = passed.length < 2 ? forward : courseControls(state, checkpoint, maxSpeed);
        const result = simulation.step(state, input, 1 / 60, mode, spec.flight, calm, clock, WORLD_BOUNDS);
        clock = result.windClock;
        if (state.collision || result.boundaryContact || result.obstacleContact) contacts++;
        assert.ok(state.position.y >= flightSurfaceHeight(state.position.x, state.position.z, previous.y) + 1.8 - 1e-8);
        if (crossesCheckpoint(previous, state.position, checkpoint)) passed.push(passed.length + 1);
      }
      assert.deepEqual(passed, [1, 2, 3, 4, 5, 6, 7, 8], `${spec.id}/${mode} stopped before gate ${passed.length + 1}`);
      assert.equal(contacts, 0, `${spec.id}/${mode} should complete the ordinary route without contacting the ground or boundary`);
    } finally { simulation.dispose(); }
  }
});
