export type MapView = 'world' | 'route';
export interface MapBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface MapPosition { x: number; z: number }
export interface MapPoint { x: number; y: number }

export const ZOOM_LEVELS = [1, 2, 4, 8] as const;
export const ROUTE_BOUNDS: MapBounds = Object.freeze({ minX: -250, maxX: 350, minZ: -600, maxZ: 150 });
export const MAP_WIDTH = 180;
export const MAP_HEIGHT = 150;
export const MAP_PADDING = 13;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** A preset at 1×; a drone-following window at higher zoom, limited to the world. */
export function getMapBounds(view: MapView, zoom: number, position: MapPosition, world: MapBounds): MapBounds {
  const base = view === 'world' ? world : ROUTE_BOUNDS;
  const factor = clamp(zoom, ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  const width = Math.min((base.maxX - base.minX) / factor, world.maxX - world.minX);
  const depth = Math.min((base.maxZ - base.minZ) / factor, world.maxZ - world.minZ);
  const centerX = clamp(factor > 1 ? position.x : (base.minX + base.maxX) / 2, world.minX + width / 2, world.maxX - width / 2);
  const centerZ = clamp(factor > 1 ? position.z : (base.minZ + base.maxZ) / 2, world.minZ + depth / 2, world.maxZ - depth / 2);
  return { minX: centerX - width / 2, maxX: centerX + width / 2, minZ: centerZ - depth / 2, maxZ: centerZ + depth / 2 };
}

export function createProjection(bounds: MapBounds) {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const scale = Math.min((MAP_WIDTH - MAP_PADDING * 2) / width, (MAP_HEIGHT - MAP_PADDING * 2) / depth);
  const left = (MAP_WIDTH - width * scale) / 2;
  const top = (MAP_HEIGHT - depth * scale) / 2;
  return {
    left, top, width: width * scale, height: depth * scale,
    project: (x: number, z: number): MapPoint => ({ x: left + (x - bounds.minX) * scale, y: top + (z - bounds.minZ) * scale }),
  };
}

export function isOutsideBounds(position: MapPosition, bounds: MapBounds): boolean {
  return position.x < bounds.minX || position.x > bounds.maxX || position.z < bounds.minZ || position.z > bounds.maxZ;
}

export function formatMapSpan(bounds: MapBounds): string {
  const meters = bounds.maxX - bounds.minX;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}
