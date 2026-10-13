import type { Vec3 } from './flight.ts';

/** Deliberately arcade-only tuning for the fictional practice weapon. */
export const GUN_CAPACITY = 40;
export const GUN_SHOTS_PER_SECOND = 24;
export const GUN_RELOAD_TIME = 2.4;
export const GUN_RANGE = 360;
export const GUN_SHOT_LIFETIME = 0.45;
export const GUN_IMPACT_LIFETIME = 0.3;
export const GUN_MAX_SHOTS = 16;
export const GUN_MAX_IMPACTS = 16;

export interface GunShot { id: number; from: Vec3; to: Vec3; age: number }
export interface GunImpact { id: number; position: Vec3; age: number; hit: boolean }
export interface GunState {
  ammo: number;
  reloadRemaining: number;
  score: number;
  hitTargetIds: string[];
  shots: GunShot[];
  impacts: GunImpact[];
  totalShots: number;
}

export function createGunState(): GunState {
  return { ammo: GUN_CAPACITY, reloadRemaining: 0, score: 0, hitTargetIds: [],
    shots: [], impacts: [], totalShots: 0 };
}
