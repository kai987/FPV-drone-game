import type { Vec3 } from './flight.ts';
import type { Bomb } from './weapons.ts';
import { SIMULATION_STEP_SECONDS } from './simulation-clock.ts';

/** Presentation only: physical positions and velocities remain untouched. */
export function interpolateBombPosition(current: Readonly<Bomb>, previous: Readonly<Bomb> | undefined,
  alpha: number, target: Vec3): void {
  const blend = Number.isFinite(alpha) ? Math.max(0, Math.min(alpha, 1)) : 1;
  if (previous?.id === current.id) {
    target.x = previous.position.x + (current.position.x - previous.position.x) * blend;
    target.y = previous.position.y + (current.position.y - previous.position.y) * blend;
    target.z = previous.position.z + (current.position.z - previous.position.z) * blend;
  } else {
    // A fresh projectile shares the aircraft's one-step presentation delay.
    // Never extrapolate farther than that step or carry a removed ID forward.
    const delay = (1 - blend) * SIMULATION_STEP_SECONDS;
    target.x = current.position.x - current.velocity.x * delay;
    target.y = current.position.y - current.velocity.y * delay;
    target.z = current.position.z - current.velocity.z * delay;
  }
}
