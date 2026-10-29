import { CHECKPOINTS } from './courses.ts';
import { WORLD_BOUNDS } from './landscape.ts';
import { TARGETS } from './weapons.ts';
import type { Checkpoint, Vec3 } from './flight.ts';
import type { Target } from './weapons.ts';
import { explorationGroundHeight } from './exploration-layout.ts';
import type { ExplorationMapId } from './exploration-layout.ts';

export type MapId = 'valley' | 'factory' | 'harbor' | ExplorationMapId;
export const DEFAULT_MAP_ID: MapId = 'valley';
export const URBAN_WORLD_BOUNDS = Object.freeze({ minX: -3600, maxX: 3600, minZ: -4300, maxZ: 2900, maxAltitude: 450 });
export const EXPLORATION_WORLD_BOUNDS = Object.freeze({ minX: -2400, maxX: 2400, minZ: -2400, maxZ: 2400, maxAltitude: 450 });
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
function explorationSpawn(id: ExplorationMapId): Vec3 {
  return { x: 0, y: explorationGroundHeight(id, 0, 80) + 20, z: 80 };
}
function explorationCourse(id: ExplorationMapId, points: readonly [number, number, number][]): Checkpoint[] {
  const spawn = explorationSpawn(id);
  return points.map(([x, z, clearance], index) => {
    const previous = index ? { x: points[index - 1][0], z: points[index - 1][1] } : spawn;
    return { position: { x, y: explorationGroundHeight(id, x, z) + clearance, z },
      yaw: Math.atan2(-(x - previous.x), -(z - previous.z)), radius: 11.5 };
  });
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
  {
    id: 'desert', number: '04', name: '赤沙沙漠', englishName: 'DUNE FRONTIER',
    description: '掠过起伏沙丘、风蚀岩柱与荒漠营地。', themeLabel: '荒漠', areaLabel: '23 km²',
    spawn: explorationSpawn('desert'), spawnYaw: 0, bounds: EXPLORATION_WORLD_BOUNDS,
    routeBounds: { minX: -700, maxX: 750, minZ: -1350, maxZ: 300 },
    checkpoints: explorationCourse('desert', [[0,20,20],[0,-220,35],[240,-500,45],[550,-800,55],
      [180,-1100,55],[-280,-900,48],[-450,-500,42],[-190,-80,32]]),
    targets: targets('desert', [[0,80],[240,-220],[550,-800],[-280,-900],[-450,-500]]),
  },
  {
    id: 'downtown', number: '05', name: '城市中心', englishName: 'CITY CENTRE',
    description: '沿着城市大道穿行，探索高楼、广场与屋顶。', themeLabel: '都市', areaLabel: '23 km²',
    spawn: explorationSpawn('downtown'), spawnYaw: 0, bounds: EXPLORATION_WORLD_BOUNDS,
    routeBounds: { minX: -180, maxX: 1050, minZ: -1050, maxZ: 300 },
    checkpoints: explorationCourse('downtown', [[0,5,24],[0,-400,36],[0,-800,60],[400,-800,82],
      [800,-800,90],[800,-400,65],[800,0,48],[400,0,36]]),
    targets: targets('downtown', [[0,80],[400,0],[800,-400],[0,-800],[400,-800]]),
  },
  {
    id: 'mountains', number: '06', name: '雪岭山区', englishName: 'ALPINE RIDGES',
    description: '沿着高山峡谷攀升，穿越雪峰、松林与岩壁。', themeLabel: '高山', areaLabel: '23 km²',
    spawn: explorationSpawn('mountains'), spawnYaw: 0, bounds: Object.freeze({ ...EXPLORATION_WORLD_BOUNDS, maxAltitude: 800 }),
    routeBounds: { minX: -850, maxX: 850, minZ: -1450, maxZ: 300 },
    checkpoints: explorationCourse('mountains', [[0,20,24],[0,-240,55],[250,-500,70],[600,-850,80],
      [300,-1200,85],[-350,-1050,85],[-600,-550,70],[-250,-100,48]]),
    targets: targets('mountains', [[0,80],[200,-240],[600,-850],[-350,-1050],[-600,-550]]),
  },
];
export function getMapSpec(id: MapId): MapSpec {
  return MAPS.find(map => map.id === id) ?? MAPS[0];
}
