import type { Vec3 } from './flight';

export interface Target {
  id: string;
  position: Vec3;
  radius: number;
}

/** Fictional practice targets; their displayed height comes from the terrain. */
export const TARGETS: readonly Target[] = Object.freeze([
  { id: 'target-1', position: { x: 0, y: 0, z: 55 }, radius: 4 },
  { id: 'target-2', position: { x: 0, y: 0, z: -65 }, radius: 4 },
  { id: 'target-3', position: { x: 80, y: 0, z: -230 }, radius: 4 },
  { id: 'target-4', position: { x: 20, y: 0, z: -455 }, radius: 4 },
  { id: 'target-5', position: { x: -145, y: 0, z: -205 }, radius: 4 },
]);

export const BOMB_CAPACITY = 6;
export const BOMB_GRAVITY = 18;
export const DROP_COOLDOWN = 0.45;
export const RELOAD_TIME = 3;
export const BLAST_RADIUS = 9;
export const EXPLOSION_LIFETIME = 3.8;
export const MAX_ACTIVE_BOMBS = 24;
export const MAX_ACTIVE_EXPLOSIONS = 32;

export const MAX_SUBSTEP = 1 / 60;
export const MAX_SUBSTEPS = 600;
export const TIMER_EPSILON = 1e-9;

export interface Bomb {
  id: number;
  position: Vec3;
  velocity: Vec3;
}

export interface Explosion {
  id: number;
  position: Vec3;
  age: number;
  hitCount: number;
}

export interface WeaponState {
  bombs: Bomb[];
  explosions: Explosion[];
  ammo: number;
  reloadRemaining: number;
  cooldown: number;
  score: number;
  hitTargetIds: string[];
  nextId: number;
}

/** Optional origin height lets game scenery distinguish a deck from the ground below it. */
export type ImpactSurface = (x: number, z: number, fromY?: number) => number;

export function createWeaponState(): WeaponState {
  return {
    bombs: [],
    explosions: [],
    ammo: BOMB_CAPACITY,
    reloadRemaining: 0,
    cooldown: 0,
    score: 0,
    hitTargetIds: [],
    nextId: 1,
  };
}

function finiteVector(vector: Vec3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

/** Releases a game projectile without retaining references to the drone state. */
export function dropBomb(state: WeaponState, position: Vec3, velocity: Vec3): boolean {
  if (state.ammo <= 0 || state.reloadRemaining > 0 || state.cooldown > 0
    || state.bombs.length >= MAX_ACTIVE_BOMBS || !finiteVector(position) || !finiteVector(velocity)) return false;

  state.bombs.push({
    id: state.nextId++,
    position: { x: position.x, y: position.y - 0.8, z: position.z },
    velocity: { ...velocity },
  });
  state.ammo--;
  state.cooldown = DROP_COOLDOWN;
  if (state.ammo === 0) state.reloadRemaining = RELOAD_TIME;
  return true;
}

function groundAt(groundHeight: ImpactSurface, x: number, z: number, fromY?: number): number {
  const height = groundHeight(x, z, fromY);
  return Number.isFinite(height) ? height : 0;
}

function countdown(remaining: number, dt: number): number {
  const next = remaining - dt;
  return next <= TIMER_EPSILON ? 0 : next;
}

function positionAt(bomb: Bomb, time: number): Vec3 {
  return {
    x: bomb.position.x + bomb.velocity.x * time,
    y: bomb.position.y + bomb.velocity.y * time - BOMB_GRAVITY * time * time / 2,
    z: bomb.position.z + bomb.velocity.z * time,
  };
}

/** Locate ground contact along the trajectory instead of using its endpoint. */
function groundImpactTime(bomb: Bomb, dt: number, groundHeight: ImpactSurface): number | null {
  const aboveGround = (time: number) => {
    const position = positionAt(bomb, time);
    return position.y - groundAt(groundHeight, position.x, position.z, bomb.position.y);
  };
  if (aboveGround(0) <= 0) return 0;

  // Intermediate samples also catch a raised terrain section before an endpoint.
  let previousTime = 0;
  for (let sample = 1; sample <= 4; sample++) {
    const time = dt * sample / 4;
    if (aboveGround(time) <= 0) {
      let low = previousTime;
      let high = time;
      for (let iteration = 0; iteration < 18; iteration++) {
        const midpoint = (low + high) / 2;
        if (aboveGround(midpoint) > 0) low = midpoint;
        else high = midpoint;
      }
      return high;
    }
    previousTime = time;
  }
  return null;
}

/** Advances projectiles, terrain impacts, one-time target scores, and reloads. */
export function stepWeapons(
  state: WeaponState,
  dt: number,
  groundHeight: ImpactSurface,
): { impacts: number; hits: number } {
  const result = { impacts: 0, hits: 0 };
  if (!Number.isFinite(dt) || dt <= 0) return result;

  state.cooldown = countdown(state.cooldown, dt);
  if (state.reloadRemaining > 0) {
    state.reloadRemaining = countdown(state.reloadRemaining, dt);
    if (state.reloadRemaining === 0) state.ammo = BOMB_CAPACITY;
  }

  // Bound work for unusually long frames while retaining the whole elapsed time.
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_SUBSTEP)));
  const substep = dt / steps;
  for (let step = 0; step < steps; step++) {
    for (const explosion of state.explosions) explosion.age += substep;
    state.explosions = state.explosions.filter(explosion => explosion.age < EXPLOSION_LIFETIME);
    const flying: Bomb[] = [];
    for (const bomb of state.bombs) {
      const impactTime = groundImpactTime(bomb, substep, groundHeight);
      if (impactTime === null) {
        bomb.position = positionAt(bomb, substep);
        bomb.velocity.y -= BOMB_GRAVITY * substep;
        flying.push(bomb);
        continue;
      }

      const impact = positionAt(bomb, impactTime);
      impact.y = groundAt(groundHeight, impact.x, impact.z, bomb.position.y);
      let hitCount = 0;
      for (const target of TARGETS) {
        if (state.hitTargetIds.includes(target.id)) continue;
        if (Math.hypot(impact.x - target.position.x, impact.z - target.position.z) <= BLAST_RADIUS) {
          state.hitTargetIds.push(target.id);
          hitCount++;
        }
      }
      state.score += hitCount * 100;
      state.explosions.push({ id: state.nextId++, position: impact, age: substep - impactTime, hitCount });
      if (state.explosions.length > MAX_ACTIVE_EXPLOSIONS) state.explosions.shift();
      result.impacts++;
      result.hits += hitCount;
    }
    state.bombs = flying;
    state.explosions = state.explosions.filter(explosion => explosion.age < EXPLOSION_LIFETIME);
  }
  return result;
}
