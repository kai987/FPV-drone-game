import type { Vec3 } from './flight.ts';

export type WindStrength = 'calm' | 'breeze' | 'windy' | 'strong';

export interface WindSettings {
  strength: WindStrength;
  /** Meteorological origin in degrees: 0 north (-Z), 90 east (+X). */
  direction: number;
}

export const DEFAULT_WIND_SETTINGS: Readonly<WindSettings> = Object.freeze({ strength: 'breeze', direction: 315 });

/** Open-field reference speeds; sampled wind also varies with altitude and gusts. */
export const WIND_PRESETS: Readonly<Record<WindStrength, { label: string; baseSpeed: number }>> = Object.freeze({
  calm: Object.freeze({ label: '无风', baseSpeed: 0 }),
  breeze: Object.freeze({ label: '微风', baseSpeed: 2.5 }),
  windy: Object.freeze({ label: '中等风', baseSpeed: 6 }),
  strong: Object.freeze({ label: '强风', baseSpeed: 10.5 }),
});

export interface WindDescription {
  speed: number;
  fromDegrees: number;
  directionLabel: string;
  relativeLabel: string;
  /** Positive from ahead, negative from behind; metres per second. */
  headwind: number;
  /** Positive from the pilot's right, negative from the left. */
  crosswind: number;
}

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const RELATIVE = ['迎风', '右前侧风', '右侧风', '右后侧风', '顺风', '左后侧风', '左侧风', '左前侧风'];
const TAU = Math.PI * 2;
const finite = (value: number) => Number.isFinite(value) ? value : 0;
const degrees = (value: number) => ((value % 360) + 360) % 360;

/**
 * TypeScript behavior reference for Rust/WASM parity tests. Runtime sampling
 * and numeric wind descriptions come from the Rust flight core.
 * Deterministic, continuous game wind rather than a weather forecast. Smooth
 * gusts share a spatial field and strengthen slightly away from the ground.
 * An engine can freeze elapsed time while paused; sampling itself has no state.
 */
export function sampleWind(settings: WindSettings, elapsed: number, position: Vec3): Vec3 {
  const preset = Object.hasOwn(WIND_PRESETS, settings.strength) ? WIND_PRESETS[settings.strength] : undefined;
  if (!preset || preset.baseSpeed === 0 || !Number.isFinite(settings.direction)) return { x: 0, y: 0, z: 0 };
  const time = Math.max(0, finite(elapsed));
  const x = finite(position.x), z = finite(position.z);
  const altitude = Math.max(0, finite(position.y));
  const phase = x * 0.0017 + z * 0.0021;
  const gust = 1 + 0.16 * Math.sin(time * 0.43 + phase)
    + 0.075 * Math.sin(time * 1.07 + x * 0.0029 - z * 0.0013)
    + 0.035 * Math.sin(time * 0.19 - phase * 0.6);
  const altitudeFactor = 0.78 + 0.22 * (1 - Math.exp(-altitude / 60));
  const speed = preset.baseSpeed * altitudeFactor * gust;
  const bearing = degrees(settings.direction) * Math.PI / 180;
  return {
    x: -Math.sin(bearing) * speed,
    y: preset.baseSpeed * altitudeFactor * 0.025 * Math.sin(time * 0.61 + phase * 0.8),
    z: Math.cos(bearing) * speed,
  };
}

/** Test reference: airflow projected onto a yaw-0/-Z aircraft's forward/right axes. */
export function describeWind(wind: Vec3, yaw: number): WindDescription {
  const x = finite(wind.x), y = finite(wind.y), z = finite(wind.z);
  const speed = Math.hypot(x, y, z);
  const heading = finite(yaw) % TAU;
  const horizontal = Math.hypot(x, z);
  if (horizontal < 1e-8) {
    const label = speed < 1e-8 ? '无风' : '垂直阵风';
    return { speed, fromDegrees: 0, directionLabel: label, relativeLabel: label, headwind: 0, crosswind: 0 };
  }
  const fromDegrees = degrees(Math.atan2(-x, z) * 180 / Math.PI);
  const relativeDegrees = degrees(fromDegrees + heading * 180 / Math.PI);
  return {
    speed, fromDegrees,
    directionLabel: COMPASS[Math.round(fromDegrees / 45) % 8],
    relativeLabel: RELATIVE[Math.round(relativeDegrees / 45) % 8],
    headwind: x * Math.sin(heading) + z * Math.cos(heading),
    crosswind: -x * Math.cos(heading) + z * Math.sin(heading),
  };
}
