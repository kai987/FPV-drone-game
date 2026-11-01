/** Serializable user preference. Auto is resolved once for each renderer lifetime. */
export const QUALITY_PRESETS = ['auto', 'low', 'medium', 'high'] as const;
export type QualityPreset = typeof QUALITY_PRESETS[number];
export type AlpineDetail = 'low' | 'medium' | 'high';

export interface GraphicsDevice {
  isMobile: boolean;
  devicePixelRatio: number;
  viewportWidth: number;
  maxTextureSize: number;
}

export interface GraphicsQuality {
  readonly preset: QualityPreset;
  readonly maxPixelRatio: number;
  readonly panoramaResolution: 3548 | 7096;
  /** Zero disables shadow allocation and rendering entirely. */
  readonly shadowMapSize: 0 | 512 | 1024 | 2048;
  readonly alpineDetail: AlpineDetail;
  readonly detailDistance: number;
  readonly antialias: boolean;
  readonly targetFps: 30 | 60;
}

export function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === 'string' && QUALITY_PRESETS.some(preset => preset === value);
}

/** No browser globals: landscape phones remain within the mobile texture budget. */
export function resolveGraphicsQuality(preset: QualityPreset, device: GraphicsDevice): GraphicsQuality {
  const selected = isQualityPreset(preset) ? preset : 'auto';
  const dpr = Number.isFinite(device.devicePixelRatio) && device.devicePixelRatio > 0 ? device.devicePixelRatio : 1;
  const width = Number.isFinite(device.viewportWidth) ? Math.max(0, device.viewportWidth) : 0;
  const targetFps = device.isMobile ? 30 : 60;
  if (selected === 'low') return Object.freeze({ preset: selected, maxPixelRatio: Math.min(dpr, 1),
    panoramaResolution: 3548, shadowMapSize: 0, alpineDetail: 'low', detailDistance: 260, antialias: false, targetFps });
  if (selected === 'medium' || selected === 'auto' && device.isMobile) {
    return Object.freeze({ preset: selected, maxPixelRatio: Math.min(dpr, selected === 'auto' ? 1.25 : 1.5),
      panoramaResolution: 3548, shadowMapSize: selected === 'auto' ? 512 : 1024,
      alpineDetail: 'medium', detailDistance: selected === 'auto' ? 350 : 480, antialias: true, targetFps });
  }
  const maxPixelRatio = Math.min(dpr, 1.75);
  const hd = device.maxTextureSize >= 7096 && (selected === 'high' || width * maxPixelRatio > 900);
  return Object.freeze({ preset: selected, maxPixelRatio, panoramaResolution: hd ? 7096 : 3548,
    shadowMapSize: selected === 'high' ? 2048 : 1024, alpineDetail: 'high', detailDistance: 760, antialias: true, targetFps });
}
