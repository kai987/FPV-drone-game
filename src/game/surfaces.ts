import { surfaceHeight } from './landscape.ts';
import { ruralSurfaceHeight } from './rural-layout.ts';

/** Select a support below the caller, so flying or dropping beneath a bridge remains possible. */
export function flightSurfaceHeight(x: number, z: number, fromY = Infinity): number {
  const terrain = surfaceHeight(x, z);
  const structure = ruralSurfaceHeight(x, z);
  return structure !== null && fromY >= structure - 0.05 ? Math.max(terrain, structure) : terrain;
}
