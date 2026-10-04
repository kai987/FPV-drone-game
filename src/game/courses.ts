import type { Checkpoint } from './flight.ts';

/** The original valley course retains its record and numerical-test geometry. */
export const CHECKPOINTS: Checkpoint[] = [
  { position: { x: 0, y: 12, z: 5 }, yaw: 0, radius: 7.1 },
  { position: { x: 0, y: 12, z: -115 }, yaw: 0, radius: 7.1 },
  { position: { x: 80, y: 17, z: -230 }, yaw: -0.48, radius: 7.1 },
  { position: { x: 130, y: 25, z: -360 }, yaw: 0.38, radius: 7.1 },
  { position: { x: 20, y: 22, z: -455 }, yaw: 1.51, radius: 7.1 },
  { position: { x: -120, y: 18, z: -395 }, yaw: 2.5, radius: 7.1 },
  { position: { x: -145, y: 14, z: -205 }, yaw: -2.94, radius: 7.1 },
  { position: { x: -60, y: 12, z: -55 }, yaw: -2.51, radius: 7.1 },
];
