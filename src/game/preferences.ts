import { DEFAULT_DRONE_ID, DRONES } from './drone-catalog.ts';
import type { DroneId } from './drone-catalog.ts';
import { DEFAULT_MAP_ID, MAPS } from './map-catalog.ts';
import type { MapId } from './map-catalog.ts';
import type { CameraMode, FlightMode, RaceMode } from './types.ts';
import { DEFAULT_WIND_SETTINGS, WIND_PRESETS } from './wind.ts';
import type { WindSettings } from './wind.ts';
import { isQualityPreset } from './graphics-quality.ts';
import type { QualityPreset } from './graphics-quality.ts';
import { normalizeTouchSettings } from '../components/touch-settings.ts';
import type { TouchSettings } from '../components/touch-settings.ts';

export const PREFERENCES_STORAGE_KEY = 'aeroflow:preferences';
export const PREFERENCES_VERSION = 1;

export interface FlightPreferences {
  version: typeof PREFERENCES_VERSION;
  mapId: MapId;
  droneId: DroneId;
  mode: RaceMode;
  flightMode: FlightMode;
  cameraMode: CameraMode;
  windSettings: WindSettings;
  night: boolean;
  sound: boolean;
  qualityPreset: QualityPreset;
  touch: TouchSettings;
}

export function defaultFlightPreferences(): FlightPreferences {
  return { version: PREFERENCES_VERSION, mapId: DEFAULT_MAP_ID, droneId: DEFAULT_DRONE_ID,
    mode: 'race', flightMode: 'assisted', cameraMode: 'chase', windSettings: { ...DEFAULT_WIND_SETTINGS },
    night: false, sound: false, qualityPreset: 'auto', touch: normalizeTouchSettings(undefined) };
}

/** Only known settings are retained. Flight position, ammunition and progress are never serialized. */
export function normalizeFlightPreferences(value: unknown): FlightPreferences {
  const defaults = defaultFlightPreferences();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const source = value as Partial<FlightPreferences>;
  if (source.version !== PREFERENCES_VERSION) return defaults;
  const wind = source.windSettings;
  const direction = typeof wind?.direction === 'number' && Number.isFinite(wind.direction)
    ? ((wind.direction % 360) + 360) % 360 : defaults.windSettings.direction;
  return {
    version: PREFERENCES_VERSION,
    mapId: MAPS.some(map => map.id === source.mapId) ? source.mapId! : defaults.mapId,
    droneId: DRONES.some(drone => drone.id === source.droneId) ? source.droneId! : defaults.droneId,
    mode: source.mode === 'race' || source.mode === 'free' ? source.mode : defaults.mode,
    flightMode: source.flightMode === 'assisted' || source.flightMode === 'sport' ? source.flightMode : defaults.flightMode,
    cameraMode: source.cameraMode === 'chase' || source.cameraMode === 'bomb' || source.cameraMode === 'fpv' ? source.cameraMode : defaults.cameraMode,
    windSettings: { strength: wind && Object.hasOwn(WIND_PRESETS, wind.strength) ? wind.strength : defaults.windSettings.strength, direction },
    night: typeof source.night === 'boolean' ? source.night : defaults.night,
    sound: typeof source.sound === 'boolean' ? source.sound : defaults.sound,
    qualityPreset: isQualityPreset(source.qualityPreset) ? source.qualityPreset : defaults.qualityPreset,
    touch: normalizeTouchSettings(source.touch),
  };
}

export function readFlightPreferences(storage?: Pick<Storage, 'getItem'>): FlightPreferences {
  try {
    const value = storage?.getItem(PREFERENCES_STORAGE_KEY);
    return value && value.length <= 8_192 ? normalizeFlightPreferences(JSON.parse(value)) : defaultFlightPreferences();
  } catch { return defaultFlightPreferences(); }
}

export function saveFlightPreferences(storage: Pick<Storage, 'setItem'>, preferences: FlightPreferences): boolean {
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeFlightPreferences(preferences)));
    return true;
  } catch { return false; }
}
