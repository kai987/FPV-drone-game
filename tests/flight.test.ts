import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlightState, crossesCheckpoint, stepFlight } from '../src/game/flight.ts';
import type { Checkpoint, FlightInput } from '../src/game/flight.ts';

const idle: FlightInput = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
const forward: FlightInput = { ...idle, forward: 1 };

test('forward follows the camera yaw and pitch, while a neutral drone hovers', () => {
  const north = createFlightState();
  stepFlight(north, forward, 1 / 60);
  assert.ok(north.position.z < 55);
  assert.equal(north.position.x, 0);
  assert.equal(north.position.y, 12);

  const west = createFlightState(undefined, Math.PI / 2);
  west.pitch = 0.3;
  stepFlight(west, forward, 1 / 60);
  assert.ok(west.position.x < 0);
  assert.ok(west.position.y > 12);
  assert.ok(Math.abs(west.position.z - 55) < 1e-10);

  const hover = createFlightState();
  for (let frame = 0; frame < 120; frame++) stepFlight(hover, idle, 1 / 60);
  assert.deepEqual(hover.position, { x: 0, y: 12, z: 55 });
});

test('acceleration and travel are stable at 30, 60, and 120 frames per second', () => {
  const positions = [30, 60, 120].map((fps) => {
    const state = createFlightState();
    for (let frame = 0; frame < fps * 3; frame++) stepFlight(state, forward, 1 / fps);
    return state.position.z;
  });
  assert.ok(Math.abs(positions[0] - positions[1]) < 1e-9);
  assert.ok(Math.abs(positions[1] - positions[2]) < 1e-9);
});

test('sport is faster, boost increases speed, and diagonals keep the speed ceiling', () => {
  const assisted = createFlightState();
  const sport = createFlightState();
  const boosted = createFlightState();
  const diagonal = createFlightState();
  for (let frame = 0; frame < 360; frame++) {
    stepFlight(assisted, forward, 1 / 60, 'assisted');
    stepFlight(sport, forward, 1 / 60, 'sport');
    stepFlight(boosted, { ...forward, boost: true }, 1 / 60, 'assisted');
    stepFlight(diagonal, { ...forward, strafe: 1, climb: 1 }, 1 / 60, 'assisted');
  }
  assert.ok(Math.abs(sport.velocity.z) > Math.abs(assisted.velocity.z));
  assert.ok(Math.abs(boosted.velocity.z) > Math.abs(assisted.velocity.z));
  assert.ok(Math.hypot(diagonal.velocity.x, diagonal.velocity.y, diagonal.velocity.z) <= 20 + 1e-9);
});

test('terrain contact keeps the drone above the ground and produces a small bounce', () => {
  const state = createFlightState({ x: 0, y: 6.9, z: 0 });
  state.velocity.y = -10;
  stepFlight(state, { ...idle, climb: -1 }, 1 / 60, 'assisted', () => 5);
  assert.equal(state.position.y, 6.8);
  assert.equal(state.collision, true);
  assert.ok(state.velocity.y > 0 && state.velocity.y <= 1.2);

  stepFlight(state, { ...idle, climb: 1 }, 1 / 60, 'assisted', () => 5);
  assert.equal(state.collision, false);
  assert.ok(state.position.y > 6.8);
});

test('invalid or paused time cannot advance the drone and long frames stay bounded', () => {
  const state = createFlightState();
  const before = structuredClone(state);
  for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) stepFlight(state, forward, dt);
  assert.deepEqual(state, before);
  stepFlight(state, forward, 30);
  assert.ok(state.position.z > 54);
});

test('pitch has a bounded camera angle and positive yaw turns left', () => {
  const state = createFlightState();
  for (let frame = 0; frame < 180; frame++) stepFlight(state, { ...idle, lookPitch: 1 }, 1 / 60);
  assert.equal(state.pitch, 0.75);
  stepFlight(state, { ...idle, yaw: 1 }, 1 / 60);
  assert.ok(state.yaw > 0);
});

const checkpoint: Checkpoint = { position: { x: 0, y: 12, z: 0 }, yaw: 0, radius: 4 };

test('a fast forward swept pass through a ring counts even when both endpoints are far away', () => {
  assert.equal(crossesCheckpoint({ x: 0, y: 12, z: 40 }, { x: 0, y: 12, z: -40 }, checkpoint), true);
  assert.equal(crossesCheckpoint({ x: -20, y: 12, z: 20 }, { x: 20, y: 12, z: -20 }, checkpoint), true);
});

test('reverse travel, missed openings, and paths that do not cross the ring do not count', () => {
  assert.equal(crossesCheckpoint({ x: 0, y: 12, z: -40 }, { x: 0, y: 12, z: 40 }, checkpoint), false);
  assert.equal(crossesCheckpoint({ x: 5, y: 12, z: 40 }, { x: 5, y: 12, z: -40 }, checkpoint), false);
  assert.equal(crossesCheckpoint({ x: 0, y: 17, z: 40 }, { x: 0, y: 17, z: -40 }, checkpoint), false);
  assert.equal(crossesCheckpoint({ x: 0, y: 12, z: 40 }, { x: 0, y: 12, z: 1 }, checkpoint), false);
  assert.equal(crossesCheckpoint({ x: -2, y: 12, z: 0 }, { x: 2, y: 12, z: 0 }, checkpoint), false);
});

test('checkpoint yaw rotates the crossing plane and forward direction', () => {
  const westbound = { ...checkpoint, yaw: Math.PI / 2 };
  assert.equal(crossesCheckpoint({ x: 20, y: 12, z: 0 }, { x: -20, y: 12, z: 0 }, westbound), true);
  assert.equal(crossesCheckpoint({ x: -20, y: 12, z: 0 }, { x: 20, y: 12, z: 0 }, westbound), false);
  assert.equal(crossesCheckpoint({ x: 20, y: 12, z: 5 }, { x: -20, y: 12, z: 5 }, westbound), false);
});
