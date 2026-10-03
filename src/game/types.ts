import type { Vec3 } from './flight';
export type RaceMode = 'race' | 'free';
export type FlightMode = 'assisted' | 'sport';
export type Status = 'ready' | 'flying' | 'paused' | 'finished';
export interface Telemetry {
  speed: number; altitude: number; elapsed: number; checkpoint: number;
  position: Vec3; yaw: number; pitch: number; roll: number;
}
export const EMPTY_TELEMETRY: Telemetry = {
  speed: 0, altitude: 12, elapsed: 0, checkpoint: 0,
  position: { x: 0, y: 12, z: 55 }, yaw: 0, pitch: 0, roll: 0,
};
export function formatTime(seconds: number) {
  const centiseconds = Math.floor(Math.max(0, seconds) * 100);
  return `${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}
