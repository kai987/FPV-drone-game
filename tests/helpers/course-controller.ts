import type { Checkpoint, FlightInput, FlightState } from '../../src/game/flight.ts';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Test pilot uses ordinary bounded inputs and aims through, not at, each gate. */
export function courseControls(state: FlightState, checkpoint: Checkpoint, maxSpeed: number): FlightInput {
  const dx = checkpoint.position.x - Math.sin(checkpoint.yaw) * 5 - state.position.x;
  const dz = checkpoint.position.z - Math.cos(checkpoint.yaw) * 5 - state.position.z;
  const desiredYaw = Math.atan2(-dx, -dz);
  const yawError = Math.atan2(Math.sin(desiredYaw - state.yaw), Math.cos(desiredYaw - state.yaw));
  const approachScale = Math.min(maxSpeed, 45.9) / maxSpeed;
  return {
    forward: clamp(Math.hypot(dx, dz) / 22, 0.35, 1) * Math.max(0, Math.cos(yawError)) * approachScale,
    strafe: 0,
    climb: clamp((checkpoint.position.y - state.position.y - state.velocity.y * 0.4) / 8, -1, 1),
    yaw: clamp(yawError * 3, -1, 1),
  };
}
