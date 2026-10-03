import type { Vec3 } from './flight.ts';
import { groundHeight, isWater, LAKES, RIVER_SAMPLES, WATER_LEVEL } from './landscape.ts';

export interface Cabin {
  id: string; name: string; x: number; z: number; yaw: number;
  width: number; depth: number; wallHeight: number; roofHeight: number; baseY: number;
}
export interface RuralBridge {
  id: string; name: string; x: number; z: number; yaw: number;
  length: number; width: number; span: number; rampLength: number; deckY: number;
  landingA: Vec3; landingB: Vec3;
}
export interface Pasture {
  id: string; species: 'cow' | 'sheep'; x: number; z: number; radius: number; count: number;
}
export interface FishSchool { id: string; points: readonly Vec3[]; count: number; spread: number }

function cabin(id: string, name: string, x: number, z: number, yaw: number, width: number, depth: number): Cabin {
  const cornerHeights = [-1, 1].flatMap(sx => [-1, 1].map(sz => {
    const localX = sx * width / 2;
    const localZ = sz * depth / 2;
    return groundHeight(x + localX * Math.cos(yaw) + localZ * Math.sin(yaw), z - localX * Math.sin(yaw) + localZ * Math.cos(yaw));
  }));
  return { id, name, x, z, yaw, width, depth, wallHeight: 3.25, roofHeight: 1.9, baseY: Math.max(...cornerHeights) + 0.2 };
}

export const CABINS: readonly Cabin[] = Object.freeze([
  cabin('cabin-1', '牧场小屋', -67, -23, 0.12, 7.6, 6.4),
  cabin('cabin-2', '河谷木屋', -111, -40, -0.22, 8.0, 6.6),
  cabin('cabin-3', '林边小屋', -126, -112, 0.3, 7.2, 6.2),
]);

export const PASTURES: readonly Pasture[] = Object.freeze([
  { id: 'cow-pasture', species: 'cow', x: -107, z: 21, radius: 13, count: 5 },
  { id: 'sheep-pasture', species: 'sheep', x: -167, z: -58, radius: 12, count: 8 },
]);

function makeBridge(): RuralBridge {
  let index = 1;
  for (let i = 2; i < RIVER_SAMPLES.length - 1; i++) {
    if (Math.abs(RIVER_SAMPLES[i].z - 70) < Math.abs(RIVER_SAMPLES[index].z - 70)) index = i;
  }
  const center = RIVER_SAMPLES[index];
  const before = RIVER_SAMPLES[index - 1];
  const after = RIVER_SAMPLES[index + 1];
  const tangentX = after.x - before.x;
  const tangentZ = after.z - before.z;
  const tangentLength = Math.hypot(tangentX, tangentZ);
  const normalX = tangentZ / tangentLength;
  const normalZ = -tangentX / tangentLength;
  const bankDistance = (side: number) => {
    for (let distance = 1; distance < 140; distance += 0.5) {
      if (!isWater(center.x + normalX * distance * side, center.z + normalZ * distance * side)) return distance;
    }
    throw new Error('The village bridge must reach a dry river bank.');
  };
  const left = bankDistance(-1);
  const right = bankDistance(1);
  const offset = (right - left) / 2;
  const x = center.x + normalX * offset;
  const z = center.z + normalZ * offset;
  const span = left + right + 16;
  const rampLength = 23;
  const length = span + rampLength * 2;
  const halfLength = length / 2;
  const landingA = { x: x - normalX * halfLength, z: z - normalZ * halfLength, y: 0 };
  const landingB = { x: x + normalX * halfLength, z: z + normalZ * halfLength, y: 0 };
  landingA.y = groundHeight(landingA.x, landingA.z) + 0.2;
  landingB.y = groundHeight(landingB.x, landingB.z) + 0.2;
  const deckY = Math.max(WATER_LEVEL + 6, landingA.y + 0.25, landingB.y + 0.25);
  return { id: 'village-bridge', name: '河谷木桥', x, z, yaw: Math.atan2(-normalZ, normalX), length, width: 4.8, span, rampLength, deckY, landingA, landingB };
}
export const BRIDGES: readonly RuralBridge[] = Object.freeze([makeBridge()]);

export function bridgeLocal(bridge: RuralBridge, x: number, z: number): { x: number; z: number } {
  const dx = x - bridge.x;
  const dz = z - bridge.z;
  return { x: dx * Math.cos(bridge.yaw) - dz * Math.sin(bridge.yaw), z: dx * Math.sin(bridge.yaw) + dz * Math.cos(bridge.yaw) };
}
export function bridgePoint(bridge: RuralBridge, x: number, z = 0): { x: number; z: number } {
  return { x: bridge.x + x * Math.cos(bridge.yaw) + z * Math.sin(bridge.yaw), z: bridge.z - x * Math.sin(bridge.yaw) + z * Math.cos(bridge.yaw) };
}
export function bridgeDeckY(bridge: RuralBridge, localX: number): number {
  const excess = Math.max(0, Math.abs(localX) - bridge.span / 2);
  const landing = localX < 0 ? bridge.landingA.y : bridge.landingB.y;
  return bridge.deckY + (landing - bridge.deckY) * Math.min(1, excess / bridge.rampLength);
}
export function bridgeSurfaceHeight(x: number, z: number): number | null {
  for (const bridge of BRIDGES) {
    const local = bridgeLocal(bridge, x, z);
    if (Math.abs(local.x) <= bridge.length / 2 && Math.abs(local.z) <= bridge.width / 2) return bridgeDeckY(bridge, local.x);
  }
  return null;
}
export function ruralSurfaceHeight(x: number, z: number): number | null {
  let height = bridgeSurfaceHeight(x, z);
  for (const house of CABINS) {
    const dx = x - house.x;
    const dz = z - house.z;
    const localX = dx * Math.cos(house.yaw) - dz * Math.sin(house.yaw);
    const localZ = dx * Math.sin(house.yaw) + dz * Math.cos(house.yaw);
    if (Math.abs(localX) <= house.width / 2 + 0.42 && Math.abs(localZ) <= house.depth / 2 + 0.45) {
      const roof = house.baseY + house.wallHeight + house.roofHeight - Math.abs(localX) * house.roofHeight / (house.width / 2) + 0.08;
      height = height === null ? roof : Math.max(height, roof);
    }
  }
  return height;
}

/** True when vegetation or rocks may be placed outside the rural clearings. */
export function clearance(x: number, z: number, padding = 0): boolean {
  for (const house of CABINS) {
    const dx = x - house.x;
    const dz = z - house.z;
    const localX = dx * Math.cos(house.yaw) - dz * Math.sin(house.yaw);
    const localZ = dx * Math.sin(house.yaw) + dz * Math.cos(house.yaw);
    if (Math.abs(localX) < house.width / 2 + 4 + padding && Math.abs(localZ) < house.depth / 2 + 4 + padding) return false;
  }
  for (const pasture of PASTURES) {
    if (Math.hypot(x - pasture.x, z - pasture.z) < pasture.radius + 3 + padding) return false;
  }
  for (const bridge of BRIDGES) {
    const local = bridgeLocal(bridge, x, z);
    if (Math.abs(local.x) < bridge.length / 2 + 4 + padding && Math.abs(local.z) < bridge.width / 2 + 3 + padding) return false;
  }
  return true;
}

function circleSchool(id: string, x: number, z: number, rx: number, rz: number, count: number, spread: number): FishSchool {
  const points = Array.from({ length: 32 }, (_, i) => {
    const angle = i / 32 * Math.PI * 2;
    return { x: x + Math.cos(angle) * rx, y: WATER_LEVEL - 0.3, z: z + Math.sin(angle) * rz };
  });
  return { id, points, count, spread };
}
const riverNear = RIVER_SAMPLES.reduce((best, point) => Math.abs(point.z - 95) < Math.abs(best.z - 95) ? point : best);
const riverUpper = RIVER_SAMPLES.reduce((best, point) => Math.abs(point.z + 320) < Math.abs(best.z + 320) ? point : best);
export const FISH_SCHOOLS: readonly FishSchool[] = Object.freeze([
  circleSchool('bridge-fish', riverNear.x, riverNear.z, 7, 10, 11, 1.5),
  circleSchool('river-fish', riverUpper.x, riverUpper.z, 6, 9, 9, 1.4),
  circleSchool('lake-fish', LAKES[0].x + 70, LAKES[0].z + 160, 23, 16, 14, 2.3),
  circleSchool('upper-lake-fish', LAKES[1].x - 45, LAKES[1].z + 70, 17, 12, 10, 1.8),
]);
