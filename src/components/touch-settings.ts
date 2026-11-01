export interface TouchSettings {
  sensitivity: number;
  accelerationMs: number;
  invertVertical: boolean;
}

export const DEFAULT_TOUCH_SETTINGS: Readonly<TouchSettings> = Object.freeze({
  sensitivity: 1, accelerationMs: 2_000, invertVertical: false,
});

/** Stored preferences and UI input use the same finite, bounded values. */
export function normalizeTouchSettings(value: unknown): TouchSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<TouchSettings> : {};
  const bounded = (candidate: unknown, fallback: number, minimum: number, maximum: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(minimum, Math.min(maximum, candidate)) : fallback;
  return {
    sensitivity: bounded(source.sensitivity, DEFAULT_TOUCH_SETTINGS.sensitivity, 0.5, 2),
    accelerationMs: bounded(source.accelerationMs, DEFAULT_TOUCH_SETTINGS.accelerationMs, 500, 4_000),
    invertVertical: typeof source.invertVertical === 'boolean' ? source.invertVertical : DEFAULT_TOUCH_SETTINGS.invertVertical,
  };
}
