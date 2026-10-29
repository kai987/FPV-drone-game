import type { UrbanBox } from './map-layout.ts';

export type DowntownArchetype = 'curtain-tower' | 'setback-tower' | 'twin-towers' | 'courtyard' | 'masonry' | 'hotel' | 'crowned-tower';
export type DowntownFacade = 'glass' | 'stone' | 'brick' | 'residential' | 'hotel';
export interface DowntownBuildingInput extends UrbanBox { readonly variant?: number; readonly color?: string; }
export interface DowntownBody extends UrbanBox { readonly facade: DowntownFacade; }
export interface DowntownBuildingParts {
  readonly archetype: DowntownArchetype;
  readonly bodies: readonly DowntownBody[];
  readonly caps: readonly UrbanBox[];
  readonly hvac: UrbanBox;
  readonly antenna?: UrbanBox;
  readonly solids: readonly UrbanBox[];
}
export interface DowntownRoofDetails { readonly cap: UrbanBox; readonly hvac: UrbanBox; readonly antenna?: UrbanBox; }

const ARCHETYPES: readonly DowntownArchetype[] = ['curtain-tower', 'setback-tower', 'twin-towers', 'courtyard', 'masonry', 'hotel', 'crowned-tower'];

/** Outer lot envelopes stay stable; rendered structural pieces are also the native collision pieces. */
export function getDowntownBuildingParts(building: DowntownBuildingInput): DowntownBuildingParts {
  const { x, z, width: w, depth: d, base: b, height: h } = building;
  const seed = Math.abs(Math.round(x * 11 + z * 7) + (building.variant ?? 0) * 17);
  let archetype = ARCHETYPES[seed % ARCHETYPES.length];
  if (h > 120 && archetype === 'masonry') archetype = 'hotel';
  const bodies: DowntownBody[] = [];
  const body = (dx: number, dz: number, width: number, depth: number, base: number, height: number, facade: DowntownFacade) => {
    bodies.push({ x: x + dx * w, z: z + dz * d, width: width * w, depth: depth * d, base: b + base * h, height: height * h, facade });
  };
  switch (archetype) {
    case 'curtain-tower':
      body(0, 0, 1, 1, 0, 0.14, 'stone');
      body(-0.04, -0.025, 0.72, 0.76, 0.14, 0.86, 'glass');
      break;
    case 'setback-tower':
      body(0, 0, 1, 1, 0, 0.18, 'stone');
      body(0.025, -0.025, 0.8, 0.79, 0.18, 0.58, 'glass');
      body(0.025, -0.025, 0.56, 0.59, 0.76, 0.24, 'glass');
      break;
    case 'twin-towers':
      body(0, 0, 1, 1, 0, 0.15, 'stone');
      body(-0.25, -0.025, 0.34, 0.73, 0.15, 0.85, 'glass');
      body(0.25, 0.035, 0.34, 0.73, 0.15, 0.72, 'glass');
      break;
    case 'courtyard':
      body(0, 0, 1, 1, 0, 0.12, 'stone');
      body(-0.34, 0, 0.32, 1, 0.12, 0.88, 'residential');
      body(0.16, 0.34, 0.68, 0.32, 0.12, 0.72, 'residential');
      break;
    case 'masonry':
      body(0, 0, 1, 1, 0, 0.78, 'brick');
      body(-0.055, -0.045, 0.72, 0.68, 0.78, 0.22, 'brick');
      break;
    case 'hotel':
      body(0, 0, 1, 1, 0, 0.14, 'stone');
      body(0, -0.025, 0.69, 0.82, 0.14, 0.79, 'hotel');
      body(0, -0.025, 0.57, 0.67, 0.93, 0.07, 'stone');
      break;
    case 'crowned-tower':
      body(0, 0, 1, 1, 0, 0.13, 'stone');
      body(0, -0.035, 0.65, 0.67, 0.13, 0.69, 'glass');
      body(0, -0.035, 0.76, 0.77, 0.82, 0.06, 'stone');
      body(0, -0.035, 0.46, 0.49, 0.88, 0.12, 'glass');
      break;
  }
  const caps = bodies.map(part => ({ x: part.x, z: part.z, width: part.width + 0.6, depth: part.depth + 0.6,
    base: part.base + part.height, height: 0.45 }));
  const cap = caps.reduce((top, part) => part.base > top.base ? part : top);
  const hvac: UrbanBox = { x: cap.x + cap.width * 0.15, z: cap.z - cap.depth * 0.12,
    width: Math.min(7, cap.width * 0.19), depth: Math.min(10, cap.depth * 0.2), base: cap.base + cap.height, height: 2.2 };
  const antenna: UrbanBox | undefined = h > 130 ? { x: cap.x - cap.width * 0.08, z: cap.z + cap.depth * 0.06,
    width: 0.24, depth: 0.24, base: cap.base + cap.height, height: 10 } : undefined;
  return { archetype, bodies, caps, hvac, ...(antenna ? { antenna } : {}), solids: [...bodies, ...caps, hvac, ...(antenna ? [antenna] : [])] };
}

export function getDowntownRoofDetails(building: DowntownBuildingInput): DowntownRoofDetails {
  const parts = getDowntownBuildingParts(building);
  const cap = parts.caps.reduce((top, part) => part.base > top.base ? part : top);
  return { cap, hvac: parts.hvac, ...(parts.antenna ? { antenna: parts.antenna } : {}) };
}
