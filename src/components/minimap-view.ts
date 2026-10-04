export type MapView = 'world' | 'route';
export interface MapBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface MapPosition { x: number; z: number }
export interface MapPoint { x: number; y: number }
export interface MapViewportOptions { center?: MapPosition; follow?: boolean; routeBounds?: MapBounds }
export interface MapViewportSize { width: number; height: number }

export const ZOOM_LEVELS = [1, 2, 4, 8] as const;
export const ROUTE_BOUNDS: MapBounds = Object.freeze({ minX: -250, maxX: 350, minZ: -600, maxZ: 150 });
export const MAP_WIDTH = 180;
export const MAP_HEIGHT = 150;
export const MAP_PADDING = 13;
export const PAN_THRESHOLD = 4;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function getMapCenter(bounds: MapBounds): MapPosition {
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
}

/** Reposition a viewport without changing its size or leaving the world. */
export function centerMapBounds(bounds: MapBounds, center: MapPosition, world: MapBounds): MapBounds {
  const width = Math.min(bounds.maxX - bounds.minX, world.maxX - world.minX);
  const depth = Math.min(bounds.maxZ - bounds.minZ, world.maxZ - world.minZ);
  const x = clamp(center.x, world.minX + width / 2, world.maxX - width / 2);
  const z = clamp(center.z, world.minZ + depth / 2, world.maxZ - depth / 2);
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}

/** Optional centers retain a manual view; explicit follow also works at 1×. */
export function getMapBounds(view: MapView, zoom: number, position: MapPosition, world: MapBounds, options: MapViewportOptions = {}): MapBounds {
  const base = view === 'world' ? world : options.routeBounds ?? ROUTE_BOUNDS;
  const factor = clamp(zoom, ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  const width = Math.min((base.maxX - base.minX) / factor, world.maxX - world.minX);
  const depth = Math.min((base.maxZ - base.minZ) / factor, world.maxZ - world.minZ);
  const follow = options.follow ?? factor > 1;
  const center = options.center ?? (follow ? position : getMapCenter(base));
  return centerMapBounds({ minX: 0, maxX: width, minZ: 0, maxZ: depth }, center, world);
}

export function createProjection(bounds: MapBounds) {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const scale = Math.min((MAP_WIDTH - MAP_PADDING * 2) / width, (MAP_HEIGHT - MAP_PADDING * 2) / depth);
  const left = (MAP_WIDTH - width * scale) / 2;
  const top = (MAP_HEIGHT - depth * scale) / 2;
  return {
    left, top, width: width * scale, height: depth * scale, scale,
    project: (x: number, z: number): MapPoint => ({ x: left + (x - bounds.minX) * scale, y: top + (z - bounds.minZ) * scale }),
  };
}

/** Grab-map motion: content moves with the pointer, so the view center moves oppositely. */
export function panMapBounds(bounds: MapBounds, dxCss: number, dyCss: number, viewport: MapViewportSize, world: MapBounds): MapBounds {
  const svgScale = Math.min(viewport.width / MAP_WIDTH, viewport.height / MAP_HEIGHT);
  const screenScale = createProjection(bounds).scale * svgScale;
  if (!Number.isFinite(screenScale) || screenScale <= 0) return { ...bounds };
  const center = getMapCenter(bounds);
  return centerMapBounds(bounds, { x: center.x - dxCss / screenScale, z: center.z - dyCss / screenScale }, world);
}

export function hasPanGesture(dxCss: number, dyCss: number): boolean {
  return Math.hypot(dxCss, dyCss) >= PAN_THRESHOLD;
}

/** Freeze the latest followed view only when dragging starts, consuming the tap deadzone. */
export function beginMapDrag(bounds: MapBounds, pressedAt: MapPoint, pointer: MapPoint): { bounds: MapBounds; start: MapPoint } | null {
  const dx = pointer.x - pressedAt.x; const dy = pointer.y - pressedAt.y;
  if (!hasPanGesture(dx, dy)) return null;
  const deadzone = PAN_THRESHOLD / Math.hypot(dx, dy);
  return {
    bounds: { ...bounds },
    start: { x: pressedAt.x + dx * deadzone, y: pressedAt.y + dy * deadzone },
  };
}

export function isOutsideBounds(position: MapPosition, bounds: MapBounds): boolean {
  return position.x < bounds.minX || position.x > bounds.maxX || position.z < bounds.minZ || position.z > bounds.maxZ;
}

export function formatMapSpan(bounds: MapBounds): string {
  const meters = bounds.maxX - bounds.minX;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
