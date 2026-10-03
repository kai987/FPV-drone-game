import assert from 'node:assert/strict';
import test from 'node:test';
import { createFlightState, crossesCheckpoint, stepFlight } from '../src/game/flight.ts';
import type { Checkpoint, FlightInput, FlightMode, FlightState } from '../src/game/flight.ts';
import { CHECKPOINTS, groundHeight } from '../src/game/world.ts';
import { DRONES, getFlightConfig } from '../src/game/drone-catalog.ts';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const straightForward: FlightInput = { forward: 1, strafe: 0, climb: 0, yaw: 0 };

/** Steer with the same bounded control axes as a player, never moving state directly. */
function steerTowardGate(state: FlightState, checkpoint: Checkpoint, maxSpeed: number): FlightInput {
  // Aim beyond the ring so slowing near its centre still crosses its plane.
  const dx = checkpoint.position.x - Math.sin(checkpoint.yaw) * 5 - state.position.x;
  const dz = checkpoint.position.z - Math.cos(checkpoint.yaw) * 5 - state.position.z;
  const desiredYaw = Math.atan2(-dx, -dz);
  const yawError = Math.atan2(Math.sin(desiredYaw - state.yaw), Math.cos(desiredYaw - state.yaw));
  // A player can release some throttle before turns. Keep the original four
  // aircraft's controls, but request the same approach speed from faster models.
  const throttleScale = Math.min(maxSpeed, 45.9) / maxSpeed;
  return {
    forward: clamp(Math.hypot(dx, dz) / 22, 0.35, 1) * Math.max(0, Math.cos(yawError)) * throttleScale,
    strafe: 0,
    climb: clamp((checkpoint.position.y - state.position.y - state.velocity.y * 0.4) / 8, -1, 1),
    yaw: clamp(yawError * 3, -1, 1),
  };
}

for (const drone of DRONES) for (const mode of ['assisted', 'sport'] as const satisfies readonly FlightMode[]) {
  test(`the actual eight-gate course can finish with ${drone.id} in ${mode} mode using flight controls only`, () => {
    assert.equal(CHECKPOINTS.length, 8);
    const state = createFlightState();
    const crossed: number[] = [];
    let nextCheckpoint = 0;
    let groundContacts = 0;
    const maxSpeed = getFlightConfig(drone.id, mode).speed;

    for (let frame = 0; frame < 120 * 60 && nextCheckpoint < CHECKPOINTS.length; frame++) {
      const checkpoint = CHECKPOINTS[nextCheckpoint];
      const previous = { ...state.position };
      // The beginner approach should work by holding only W at spawn altitude.
      const input = nextCheckpoint < 2 ? straightForward : steerTowardGate(state, checkpoint, maxSpeed);
      stepFlight(state, input, 1 / 60, mode, groundHeight, drone.flight);
      if (state.collision) groundContacts++;
      assert.ok(state.position.y >= groundHeight(state.position.x, state.position.z) + 1.8 - 1e-9);

      if (nextCheckpoint < 2) {
        assert.equal(state.position.x, 0);
        assert.equal(state.position.y, 12);
        assert.equal(state.yaw, 0);
        assert.equal(state.pitch, 0);
      }

      if (crossesCheckpoint(previous, state.position, checkpoint)) {
        crossed.push(nextCheckpoint + 1);
        nextCheckpoint++;
      }
    }

    assert.deepEqual(crossed, [1, 2, 3, 4, 5, 6, 7, 8], `Stopped before gate ${nextCheckpoint + 1}`);
    assert.equal(groundContacts, 0, 'The normal course should remain clear of terrain');
  });
}
