import { DEFAULT_DRONE_ID } from './drone-catalog.ts';
import type { DroneId } from './drone-catalog.ts';
import type { FlightMode } from './types.ts';
import type { WindSettings } from './wind.ts';
import type { MapId } from './map-catalog.ts';

export function bestTimeKey(drone: DroneId, mode: FlightMode, wind: WindSettings, mapId: MapId = 'valley') {
  const weather = wind.strength === 'calm' ? 'calm' : `${wind.strength}:${((wind.direction % 360) + 360) % 360}`;
  return `aeroflow:v5:best:${mapId}:${drone}:${mode}:${weather}`;
}

/** Dynamic wind and denser urban maps need fresh records. Calm valley flights remain comparable. */
export function readBestTime(storage: Pick<Storage, 'getItem'>, drone: DroneId, mode: FlightMode, wind: WindSettings, mapId: MapId = 'valley'): number | null {
  const keys = [bestTimeKey(drone, mode, wind, mapId)];
  if (mapId === 'valley' && wind.strength === 'calm') {
    keys.push(`aeroflow:v3:best:${drone}:${mode}:calm`);
    keys.push(`aeroflow:v2:best:${drone}:${mode}`);
    if (drone === DEFAULT_DRONE_ID) keys.push(`aeroflow:v1:best:${mode}`);
  }
  try {
    for (const key of keys) {
      const value = Number(storage.getItem(key));
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch { /* Flight remains available when storage is blocked. */ }
  return null;
}
