import type { Vec3 } from './flight.ts';
import type { WorldObstacle } from './world.ts';
import { groundHeight } from './landscape.ts';
import { ruralSurfaceHeight } from './rural-layout.ts';

/** Circular broad phase, with true sloping roofs and open space beneath bridge parts. */
export function intersectsObstacle(position: Vec3, obstacle: WorldObstacle): boolean {
  if (Math.hypot(position.x - obstacle.x, position.z - obstacle.z) >= obstacle.radius + 0.55) return false;
  const top = obstacle.roof ? ruralSurfaceHeight(position.x, position.z) : groundHeight(obstacle.x, obstacle.z) + obstacle.height;
  return top !== null && position.y < top + 0.45 && position.y > (obstacle.base ?? -Infinity) - 0.45;
}
