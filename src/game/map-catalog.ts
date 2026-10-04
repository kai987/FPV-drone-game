import { CHECKPOINTS } from './courses.ts';
import { WORLD_BOUNDS } from './landscape.ts';
import { TARGETS } from './weapons.ts';
import type { Checkpoint, Vec3 } from './flight.ts';
import type { Target } from './weapons.ts';

export type MapId = 'valley' | 'factory' | 'harbor';
export const DEFAULT_MAP_ID: MapId = 'valley';
export const URBAN_WORLD_BOUNDS = Object.freeze({ minX: -3600, maxX: 3600, minZ: -4300, maxZ: 2900, maxAltitude: 450 });
export interface MapBounds { minX: number; maxX: number; minZ: number; maxZ: number; maxAltitude: number; }
export interface MapSpec {
  id: MapId;
  number: string;
  name: string;
  englishName: string;
  description: string;
  themeLabel: string;
  areaLabel: string;
  spawn: Vec3;
  spawnYaw: number;
  bounds: Readonly<MapBounds>;
  routeBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  checkpoints: readonly Checkpoint[];
  targets: readonly Target[];
}

function course(points: readonly [number, number, number][]): Checkpoint[] {
  return points.map(([x, y, z], index) => {
    const previous = index ? points[index - 1] : [0, 12, 55];
    return { position: { x, y, z }, yaw: Math.atan2(-(x - previous[0]), -(z - previous[2])), radius: 8.5 };
  });
}
function targets(map: MapId, points: readonly [number, number][]): Target[] {
  return points.map(([x, z], index) => ({ id: `${map}-target-${index + 1}`, position: { x, y: 0, z }, radius: 4 }));
}
export const MAPS: readonly MapSpec[] = [
  {
    id: 'valley', number: '01', name: '松林山谷', englishName: 'PINE VALLEY',
    description: '沿着河流，飞过小桥与乡间村落。', themeLabel: '乡村', areaLabel: '13 km²',
    spawn: { x: 0, y: 12, z: 55 }, spawnYaw: 0, bounds: WORLD_BOUNDS,
    routeBounds: { minX: -250, maxX: 350, minZ: -600, maxZ: 150 }, checkpoints: CHECKPOINTS, targets: TARGETS,
  },
  {
    id: 'factory', number: '02', name: '工业工厂', englishName: 'IRON WORKS',
    description: '沿着工业大道，探索生产园区、储罐与物流堆场。', themeLabel: '工业区', areaLabel: '52 km²',
    spawn: { x: 0, y: 12, z: 55 }, spawnYaw: 0, bounds: URBAN_WORLD_BOUNDS,
    routeBounds: { minX: -400, maxX: 400, minZ: -1040, maxZ: 160 },
    checkpoints: course([[0,12,5],[0,16,-140],[0,28,-330],[145,40,-525],[260,42,-780],[0,38,-900],[-260,42,-670],[-135,42,-160]]),
    targets: targets('factory', [[0,55],[0,-145],[315,-750],[-310,-710],[0,-825]]),
  },
  {
    id: 'harbor', number: '03', name: '海港码头', englishName: 'SEA PORT',
    description: '飞越沿岸码头，沿着货轮、仓储园区与堆场探索海港。', themeLabel: '滨海', areaLabel: '52 km²',
    spawn: { x: 0, y: 12, z: 55 }, spawnYaw: 0, bounds: URBAN_WORLD_BOUNDS,
    routeBounds: { minX: -320, maxX: 800, minZ: -960, maxZ: 160 },
    checkpoints: course([[0,12,5],[0,16,-125],[220,24,-250],[390,36,-480],[660,42,-620],[260,30,-810],[-160,26,-710],[-120,32,-250]]),
    targets: targets('harbor', [[0,55],[55,-135],[350,-120],[320,-430],[330,-750]]),
  },
];
export function getMapSpec(id: MapId): MapSpec {
  return MAPS.find(map => map.id === id) ?? MAPS[0];
}
