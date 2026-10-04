/** Metres, shared by the renderer, Rust collision geometry and minimap. */
export interface UrbanBox {
  x: number;
  z: number;
  width: number;
  depth: number;
  base: number;
  height: number;
  yaw?: number;
}

export interface WarehouseSpec extends UrbanBox { color: string; label: string; }
export interface ContainerSpec extends UrbanBox { color: string; }
export interface TankSpec { x: number; z: number; radius: number; height: number; }
export interface ChimneySpec { x: number; z: number; radius: number; height: number; }
export interface CraneSpec { x: number; z: number; height: number; span: number; }
export interface TruckSpec extends UrbanBox { color: string; }
export interface PipeSpec { from: readonly [number, number, number]; to: readonly [number, number, number]; radius: number; }
export interface ShipSpec { x: number; z: number; width: number; length: number; deckY: number; }
export interface MapLandmark { x: number; z: number; label: string; kind: 'warehouse' | 'tank' | 'crane' | 'ship' | 'lighthouse'; }

export const HARBOR_SHORE_X = 140;
export const HARBOR_PIERS: readonly UrbanBox[] = Object.freeze([
  { x: 260, z: -120, width: 240, depth: 70, base: -8, height: 10 },
  { x: 285, z: -430, width: 290, depth: 70, base: -8, height: 10 },
  { x: 245, z: -750, width: 210, depth: 70, base: -8, height: 10 },
]);

export interface UrbanMapLayout {
  boxes: readonly UrbanBox[];
  warehouses: readonly WarehouseSpec[];
  containers: readonly ContainerSpec[];
  tanks: readonly TankSpec[];
  chimneys: readonly ChimneySpec[];
  cranes: readonly CraneSpec[];
  trucks: readonly TruckSpec[];
  pipes: readonly PipeSpec[];
  ship?: ShipSpec;
  landmarks: readonly MapLandmark[];
}

const CONTAINER_COLORS = ['#b4513d', '#c7a543', '#3e6f86', '#527565', '#d0c5ad', '#945c42'];

function containerStacks(x: number, z: number, columns: number, rows: number, maxStack: number, yaw = 0): ContainerSpec[] {
  const containers: ContainerSpec[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const stack = 1 + (column * 7 + row * 3) % maxStack;
      const dx = column * 3.0;
      const dz = -row * 14;
      for (let level = 0; level < stack; level++) containers.push({
        x: x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
        z: z - dx * Math.sin(yaw) + dz * Math.cos(yaw),
        width: 2.44, depth: 12.2, base: 2 + level * 2.6, height: 2.6, yaw,
        color: CONTAINER_COLORS[(column + row * 3 + level * 2) % CONTAINER_COLORS.length],
      });
    }
  }
  return containers;
}

function factoryLayout(): UrbanMapLayout {
  const warehouses: WarehouseSpec[] = [
    { x: -87, z: -90, width: 78, depth: 112, base: 2, height: 16, color: '#63747a', label: 'ASSEMBLY 01' },
    { x: 90, z: -82, width: 78, depth: 104, base: 2, height: 14, color: '#aa6250', label: 'WORKSHOP 02' },
    { x: -115, z: -315, width: 100, depth: 116, base: 2, height: 22, color: '#6a7270', label: 'FABRICATION 03' },
    { x: 125, z: -325, width: 94, depth: 118, base: 2, height: 19, color: '#8b8980', label: 'LOGISTICS 04' },
    { x: -220, z: -610, width: 110, depth: 144, base: 2, height: 26, color: '#637179', label: 'POWER HOUSE' },
    { x: 230, z: -660, width: 122, depth: 164, base: 2, height: 24, color: '#815b49', label: 'FOUNDRY 06' },
    { x: -335, z: -350, width: 85, depth: 120, base: 2, height: 17, color: '#818b86', label: 'STORAGE 07' },
    { x: 360, z: -245, width: 110, depth: 135, base: 2, height: 20, color: '#647f85', label: 'DISTRIBUTION' },
    { x: -490, z: -1020, width: 120, depth: 175, base: 2, height: 22, color: '#788382', label: 'ROLLING MILL' },
    { x: 520, z: -1090, width: 180, depth: 128, base: 2, height: 26, color: '#7d7165', label: 'METAL WORKS' },
    { x: -130, z: -1380, width: 145, depth: 180, base: 2, height: 29, color: '#6c7c82', label: 'MACHINERY' },
    { x: 160, z: -1530, width: 190, depth: 130, base: 2, height: 26, color: '#8d7162', label: 'PRODUCTION' },
  ];
  const tanks: TankSpec[] = [
    { x: 82, z: -520, radius: 15, height: 23 }, { x: 121, z: -530, radius: 15, height: 23 },
    { x: 164, z: -505, radius: 12, height: 28 }, { x: -76, z: -650, radius: 19, height: 29 },
    { x: -110, z: -735, radius: 22, height: 18 },
  ];
  const chimneys: ChimneySpec[] = [
    { x: -183, z: -724, radius: 4.1, height: 86 }, { x: -222, z: -745, radius: 3.5, height: 72 },
    { x: 287, z: -775, radius: 4.4, height: 91 },
  ];
  const containers = [
    ...containerStacks(-190, 28, 6, 2, 2), ...containerStacks(170, 5, 8, 2, 3),
    ...containerStacks(-265, -435, 9, 3, 3), ...containerStacks(252, -405, 10, 3, 3),
  ];
  const trucks: TruckSpec[] = [
    { x: -43, z: -89, width: 2.7, depth: 14, base: 2, height: 4.2, color: '#d6cda9' },
    { x: 44, z: -99, width: 2.7, depth: 14, base: 2, height: 4.2, color: '#a7563e' },
    { x: 177, z: -284, width: 2.7, depth: 14, base: 2, height: 4.2, color: '#527c8e' },
    { x: -175, z: -275, width: 2.7, depth: 14, base: 2, height: 4.2, color: '#cbb472' },
  ];
  const pipes: PipeSpec[] = [
    { from: [82, 13, -520], to: [82, 13, -443], radius: 0.9 },
    { from: [82, 13, -443], to: [125, 13, -443], radius: 0.9 },
    { from: [125, 13, -443], to: [125, 13, -384], radius: 0.9 },
    { from: [-75, 15, -650], to: [-75, 15, -472], radius: 0.75 },
    { from: [-75, 15, -472], to: [-115, 15, -472], radius: 0.75 },
    { from: [-115, 15, -472], to: [-115, 15, -374], radius: 0.75 },
  ];
  const boxes: UrbanBox[] = [
    ...warehouses, ...containers, ...trucks,
    ...tanks.map(tank => ({ x: tank.x, z: tank.z, width: tank.radius * 2, depth: tank.radius * 2, base: 2, height: tank.height })),
    ...chimneys.map(chimney => ({ x: chimney.x, z: chimney.z, width: chimney.radius * 2, depth: chimney.radius * 2, base: 2, height: chimney.height })),
  ];
  for (const building of warehouses) {
    boxes.push({ x: building.x, z: building.z, width: building.width + 1.4, depth: building.depth + 1.4, base: 2 + building.height, height: 0.34 });
    for (const side of [-1, 1]) {
      const x = building.x + side * building.width * 0.3, z = building.z - building.depth * 0.2;
      boxes.push({ x, z, width: 4.5, depth: 5.5, base: 2 + building.height, height: 1.6 });
      boxes.push({ x, z: z + 9, width: 2.2, depth: 2.2, base: 2 + building.height + 0.8, height: 4.3 });
    }
  }
  for (const pipe of pipes) boxes.push({
    x: (pipe.from[0] + pipe.to[0]) / 2, z: (pipe.from[2] + pipe.to[2]) / 2,
    width: Math.abs(pipe.to[0] - pipe.from[0]) + pipe.radius * 2,
    depth: Math.abs(pipe.to[2] - pipe.from[2]) + pipe.radius * 2,
    base: pipe.from[1] - pipe.radius, height: pipe.radius * 2,
  });
  for (const pipe of pipes) {
    const length = Math.hypot(pipe.to[0] - pipe.from[0], pipe.to[2] - pipe.from[2]);
    for (let value = 0; value <= length; value += 10) boxes.push({
      x: pipe.from[0] + (pipe.to[0] - pipe.from[0]) * value / length,
      z: pipe.from[2] + (pipe.to[2] - pipe.from[2]) * value / length,
      width: 0.34, depth: 0.34, base: 2, height: pipe.from[1] - pipe.radius - 2,
    });
  }
  return { boxes, warehouses, containers, tanks, chimneys, cranes: [], trucks, pipes,
    landmarks: [
      ...warehouses.map(building => ({ x: building.x, z: building.z, label: building.label, kind: 'warehouse' as const })),
      ...tanks.map((tank, index) => ({ x: tank.x, z: tank.z, label: `储罐 ${index + 1}`, kind: 'tank' as const })),
    ],
  };
}

function harborLayout(): UrbanMapLayout {
  const warehouses: WarehouseSpec[] = [
    { x: -87, z: -125, width: 82, depth: 122, base: 2, height: 16, color: '#748c8e', label: 'PORT STORAGE 01' },
    { x: -150, z: -535, width: 150, depth: 112, base: 2, height: 18, color: '#788685', label: 'CUSTOMS TERMINAL' },
    { x: -265, z: -265, width: 94, depth: 172, base: 2, height: 17, color: '#a39c87', label: 'BONDED STORAGE' },
  ];
  const containers = [
    ...containerStacks(57, 4, 17, 4, 3), ...containerStacks(47, -205, 20, 8, 4),
    ...containerStacks(56, -545, 17, 6, 3), ...containerStacks(-197, -59, 10, 4, 4),
    ...containerStacks(-356, -420, 21, 7, 4),
    ...containerStacks(181, -106, 14, 2, 2, Math.PI / 2),
    ...containerStacks(188, -416, 14, 2, 2, Math.PI / 2),
  ];
  const cranes: CraneSpec[] = [
    { x: 258, z: -120, height: 43, span: 44 },
    { x: 300, z: -430, height: 56, span: 44 },
    { x: 235, z: -750, height: 41, span: 44 },
  ];
  const ship: ShipSpec = { x: 540, z: -473, width: 67, length: 273, deckY: 6.2 };
  const trucks: TruckSpec[] = [
    { x: 30, z: -195, width: 2.7, depth: 14, base: 2, height: 4.2, color: '#dfa647' },
    { x: -27, z: -335, width: 2.7, depth: 14, base: 2, height: 4.2, color: '#d9cbb2' },
    { x: 31, z: -597, width: 2.7, depth: 14, base: 2, height: 4.2, color: '#55889a' },
  ];
  const boxes: UrbanBox[] = [...HARBOR_PIERS, ...warehouses, ...containers, ...trucks];
  for (const building of warehouses) {
    boxes.push({ x: building.x, z: building.z, width: building.width + 1.4, depth: building.depth + 1.4, base: 2 + building.height, height: 0.34 });
    for (const side of [-1, 1]) {
      const x = building.x + side * building.width * 0.3, z = building.z - building.depth * 0.2;
      boxes.push({ x, z, width: 4.5, depth: 5.5, base: 2 + building.height, height: 1.6 });
      boxes.push({ x, z: z + 9, width: 2.2, depth: 2.2, base: 2 + building.height + 0.8, height: 4.3 });
    }
  }
  for (const crane of cranes) {
    for (const side of [-1, 1]) for (const end of [-1, 1]) boxes.push({
      x: crane.x + end * 31, z: crane.z + side * crane.span / 2,
      width: 4, depth: 4, base: 2, height: crane.height - 2,
    });
    for (const side of [-1, 1]) boxes.push({
      x: crane.x + 29, z: crane.z + side * crane.span / 2,
      width: 188, depth: 3, base: crane.height, height: 3,
    });
    for (const side of [-1, 1]) boxes.push({
      x: crane.x + 29, z: crane.z + side * crane.span / 2,
      width: 188, depth: 1.2, base: crane.height + 5.05, height: 0.9,
    });
    for (const end of [-1, 1]) boxes.push({
      x: crane.x + end * 31, z: crane.z,
      width: 4, depth: crane.span + 6, base: crane.height - 1, height: 4,
    });
    boxes.push({ x: crane.x + 70, z: crane.z, width: 11, depth: crane.span + 4, base: crane.height + 2.3, height: 3 });
    boxes.push({ x: crane.x + 79, z: crane.z + 11, width: 5.7, depth: 5.2, base: crane.height - 4.35, height: 4.5 });
    boxes.push({ x: crane.x + 70, z: crane.z, width: 10.5, depth: 13.5, base: crane.height - 22.05, height: 0.9 });
    for (const side of [-1, 1]) for (const end of [-1, 1]) boxes.push({
      x: crane.x + 70 + end * 4.3, z: crane.z + side * 6, width: 0.13, depth: 0.13, base: crane.height - 21.5, height: 22,
    });
  }
  boxes.push({ x: ship.x, z: ship.z, width: ship.width, depth: ship.length - 34, base: -8, height: ship.deckY + 8 });
  boxes.push({ x: ship.x, z: ship.z + 88, width: 35, depth: 34, base: ship.deckY, height: 26 });
  boxes.push({ x: ship.x, z: ship.z - ship.length / 2 + 8.5, width: ship.width * 0.58, depth: 17, base: -8, height: ship.deckY + 8 });
  boxes.push({ x: ship.x, z: ship.z + ship.length / 2 - 8, width: ship.width * 0.84, depth: 16, base: -8, height: ship.deckY + 8 });
  boxes.push({ x: ship.x, z: ship.z + 95, width: 8.2, depth: 9.2, base: ship.deckY + 26, height: 8.85 });
  boxes.push({ x: ship.x - 10, z: ship.z + 87, width: 0.56, depth: 0.56, base: ship.deckY + 26, height: 16 });
  for (let column = 0; column < 12; column++) for (let row = 0; row < 11; row++) for (let level = 0; level < 3 + (column + row) % 2; level++) {
    const container: ContainerSpec = { x: ship.x - 22 + column * 4, z: ship.z - 97 + row * 14,
      width: 2.44, depth: 12.2, base: ship.deckY + level * 2.6, height: 2.6,
      color: CONTAINER_COLORS[(row + column * 2 + level) % CONTAINER_COLORS.length] };
    containers.push(container); boxes.push(container);
  }
  boxes.push({ x: 108, z: -962, width: 10, depth: 10, base: 2, height: 40 });
  boxes.push({ x: 108, z: -962, width: 12.4, depth: 12.4, base: 41.9, height: 0.8 });
  boxes.push({ x: 108, z: -962, width: 7, depth: 7, base: 42.7, height: 2.8 });
  boxes.push({ x: 108, z: -962, width: 9.6, depth: 9.6, base: 45.6, height: 0.8 });
  boxes.push({ x: 500, z: -1030, width: 720, depth: 20, base: -8, height: 13 });
  return { boxes, warehouses, containers, tanks: [], chimneys: [], cranes, trucks, pipes: [], ship,
    landmarks: [
      ...warehouses.map(building => ({ x: building.x, z: building.z, label: building.label, kind: 'warehouse' as const })),
      ...cranes.map((crane, index) => ({ x: crane.x, z: crane.z, label: `桥吊 ${index + 1}`, kind: 'crane' as const })),
      { x: ship.x, z: ship.z, label: '货轮 MERIDIAN', kind: 'ship' },
      { x: 108, z: -962, label: '灯塔', kind: 'lighthouse' },
    ],
  };
}

const FACTORY_LAYOUT = factoryLayout();
const HARBOR_LAYOUT = harborLayout();
const EMPTY_LAYOUT: UrbanMapLayout = { boxes: [], warehouses: [], containers: [], tanks: [], chimneys: [], cranes: [], trucks: [], pipes: [], landmarks: [] };

export function getMapLayout(mapId: string): UrbanMapLayout {
  if (mapId === 'factory') return FACTORY_LAYOUT;
  if (mapId === 'harbor') return HARBOR_LAYOUT;
  return EMPTY_LAYOUT;
}
