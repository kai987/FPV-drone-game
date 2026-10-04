import type { RoadRectangle, RoadMarking, RoadCrossing, RoadIntersection, UrbanRoadNetwork } from './urban-roads.ts';

export interface AccessPoint { x: number; z: number; }
export interface AccessBounds { minX: number; maxX: number; minZ: number; maxZ: number; }
export interface AccessSolid extends RoadRectangle { base: number; height: number; yaw?: number; }
export interface AccessWarehouse extends AccessSolid { label: string; }
export interface BuildingAccess {
  buildingIndex: number;
  label: string;
  door: AccessPoint;
  entry: AccessPoint;
  /** Starts at the loading apron and ends on a main-road centre line. */
  points: readonly AccessPoint[];
  surfaceIndices: readonly number[];
}
export interface BuildingAccessResult { network: UrbanRoadNetwork; accesses: readonly BuildingAccess[]; unreachable: readonly number[]; }

interface Area extends AccessBounds {}
interface Line { axis: 'x' | 'z'; coordinate: number; start: number; end: number; }
const WIDTH = 12, STEP = 16, MARGIN = 8.5, EPS = 1e-7;

function area(rect: RoadRectangle, padding = 0, yaw = 0): Area {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const hx = (rect.width * c + rect.depth * s) / 2 + padding;
  const hz = (rect.depth * c + rect.width * s) / 2 + padding;
  return { minX: rect.x - hx, maxX: rect.x + hx, minZ: rect.z - hz, maxZ: rect.z + hz };
}
function overlap(a: Area, b: Area): boolean {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}
function contains(a: Area, p: AccessPoint, inset = 0): boolean {
  return p.x >= a.minX + inset - EPS && p.x <= a.maxX - inset + EPS
    && p.z >= a.minZ + inset - EPS && p.z <= a.maxZ - inset + EPS;
}
function rectangle(line: Line, width = WIDTH): RoadRectangle {
  return line.axis === 'x'
    ? { x: (line.start + line.end) / 2, z: line.coordinate, width: line.end - line.start, depth: width }
    : { x: line.coordinate, z: (line.start + line.end) / 2, width, depth: line.end - line.start };
}
function segment(a: AccessPoint, b: AccessPoint): Line | undefined {
  if (Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS) return;
  if (Math.abs(a.z - b.z) < EPS) return { axis: 'x', coordinate: a.z, start: Math.min(a.x, b.x), end: Math.max(a.x, b.x) };
  if (Math.abs(a.x - b.x) < EPS) return { axis: 'z', coordinate: a.x, start: Math.min(a.z, b.z), end: Math.max(a.z, b.z) };
  throw new Error('Access road segments must be axis aligned');
}
function mergeLines(lines: readonly Line[]): Line[] {
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const key = `${line.axis}:${line.coordinate.toFixed(6)}`;
    const group = groups.get(key) ?? []; group.push(line); groups.set(key, group);
  }
  const result: Line[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start);
    let current = { ...group[0] };
    for (const next of group.slice(1)) {
      if (next.start <= current.end + EPS) current.end = Math.max(current.end, next.end);
      else { result.push(current); current = { ...next }; }
    }
    result.push(current);
  }
  return result;
}
function subtract(rect: RoadRectangle, cut: Area): RoadRectangle[] {
  const a = area(rect);
  if (!overlap(a, cut)) return [rect];
  const x0 = Math.max(a.minX, cut.minX), x1 = Math.min(a.maxX, cut.maxX);
  const z0 = Math.max(a.minZ, cut.minZ), z1 = Math.min(a.maxZ, cut.maxZ);
  return [
    { minX: a.minX, maxX: x0, minZ: a.minZ, maxZ: a.maxZ },
    { minX: x1, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ },
    { minX: x0, maxX: x1, minZ: a.minZ, maxZ: z0 },
    { minX: x0, maxX: x1, minZ: z1, maxZ: a.maxZ },
  ].filter(piece => piece.maxX - piece.minX > EPS && piece.maxZ - piece.minZ > EPS)
    .map(piece => ({ x: (piece.minX + piece.maxX) / 2, z: (piece.minZ + piece.maxZ) / 2,
      width: piece.maxX - piece.minX, depth: piece.maxZ - piece.minZ }));
}
function clip<T extends RoadRectangle>(rect: T, cuts: readonly Area[]): T[] {
  let pieces: T[] = [rect];
  const original = area(rect);
  for (const cut of cuts) {
    if (!overlap(original, cut)) continue;
    const next: T[] = [];
    for (const piece of pieces) {
      if (!overlap(area(piece), cut)) next.push(piece);
      else for (const part of subtract(piece, cut)) next.push({ ...piece, ...part });
    }
    pieces = next;
  }
  return pieces;
}

/** Private streets use compact two-metre crossings; nearby forks can share one. */
function junctionLayout(base: UrbanRoadNetwork, lines: readonly Line[], surfaces: readonly RoadRectangle[]) {
  const existing = base.surfaces.map(rect => ({
    axis: rect.depth > rect.width ? 'z' as const : 'x' as const,
    coordinate: rect.depth > rect.width ? rect.x : rect.z,
    start: rect.depth > rect.width ? rect.z - rect.depth / 2 : rect.x - rect.width / 2,
    end: rect.depth > rect.width ? rect.z + rect.depth / 2 : rect.x + rect.width / 2,
    width: Math.min(rect.width, rect.depth),
  }));
  const axes = [...existing, ...lines.map(line => ({ ...line, width: WIDTH }))];
  const horizontal = axes.filter(line => line.axis === 'x'), vertical = axes.filter(line => line.axis === 'z');
  const candidates = new Map<string, RoadIntersection>(), covered = (rect: RoadRectangle) => {
    const a = area(rect); return surfaces.some(surface => {
      const b = area(surface); return b.minX <= a.minX + EPS && b.maxX >= a.maxX - EPS
        && b.minZ <= a.minZ + EPS && b.maxZ >= a.maxZ - EPS;
    });
  };
  for (const h of horizontal) for (const v of vertical) {
    const x = v.coordinate, z = h.coordinate;
    if (x < h.start - EPS || x > h.end + EPS || z < v.start - EPS || z > v.end + EPS) continue;
    if (base.intersections.some(junction => Math.abs(junction.x - x) < EPS && Math.abs(junction.z - z) < EPS)) continue;
    const key = `${x.toFixed(6)}:${z.toFixed(6)}`;
    if (candidates.has(key)) continue;
    const hs = horizontal.filter(line => Math.abs(line.coordinate - z) < EPS && x >= line.start - EPS && x <= line.end + EPS);
    const vs = vertical.filter(line => Math.abs(line.coordinate - x) < EPS && z >= line.start - EPS && z <= line.end + EPS);
    const width = Math.max(...vs.map(line => line.width)), depth = Math.max(...hs.map(line => line.width));
    const directions: RoadCrossing['direction'][] = [];
    if (vs.some(line => line.start < z - EPS)) directions.push('north');
    if (vs.some(line => line.end > z + EPS)) directions.push('south');
    if (hs.some(line => line.start < x - EPS)) directions.push('west');
    if (hs.some(line => line.end > x + EPS)) directions.push('east');
    if (directions.length < 3) continue;
    const crossings = directions.map(direction => direction === 'north' || direction === 'south'
      ? { direction, x, z: z + (direction === 'north' ? -1 : 1) * (depth / 2 + 2), width: width - (width > 20 ? 7 : 4), depth: 2 }
      : { direction, x: x + (direction === 'west' ? -1 : 1) * (width / 2 + 2), z, width: 2, depth: depth - (depth > 20 ? 5 : 4) });
    // An apron turn with an extremely short arm is not a pedestrian junction.
    if (crossings.every(covered)) candidates.set(key, { x, z, width, depth, crossings });
  }
  const additions = [...candidates.values()];
  const centers = [...base.intersections, ...additions].map(junction => area(junction));
  // Keep a crossing outside every neighbouring carriageway junction, including old crossroads.
  const junctions = additions.filter(junction => junction.crossings.every(crossing => centers.every(center => !overlap(area(crossing), center))));
  const markings: RoadMarking[] = [], painted = new Set<string>();
  for (const junction of junctions) for (const crossing of junction.crossings) {
    const key = `${crossing.x.toFixed(6)}:${crossing.z.toFixed(6)}:${crossing.width}:${crossing.depth}`;
    if (!painted.has(key)) {
      painted.add(key);
      if (crossing.direction === 'north' || crossing.direction === 'south') {
        for (let offset = -(crossing.width - 1) / 2; offset <= (crossing.width - 1) / 2 + EPS; offset += 2)
          markings.push({ kind: 'zebra', x: crossing.x + offset, z: crossing.z, width: 1, depth: crossing.depth });
      } else {
        for (let offset = -(crossing.depth - 1) / 2; offset <= (crossing.depth - 1) / 2 + EPS; offset += 2)
          markings.push({ kind: 'zebra', x: crossing.x, z: crossing.z + offset, width: crossing.width, depth: 1 });
      }
    }
    // At a T only the terminating arm stops; through traffic retains priority.
    const opposite = { north: 'south', south: 'north', west: 'east', east: 'west' } as const;
    if (junction.crossings.length === 3 && junction.crossings.some(arm => arm.direction === opposite[crossing.direction])) continue;
    const stop: RoadMarking = crossing.direction === 'north' || crossing.direction === 'south'
      ? { kind: 'stop', x: junction.x + (crossing.direction === 'north' ? -1 : 1) * junction.width / 4,
        z: crossing.z + (crossing.direction === 'north' ? -2.5 : 2.5), width: junction.width / 2 - 2, depth: 0.35 }
      : { kind: 'stop', x: crossing.x + (crossing.direction === 'west' ? -2.5 : 2.5),
        z: junction.z + (crossing.direction === 'west' ? 1 : -1) * junction.depth / 4, width: 0.35, depth: junction.depth / 2 - 2 };
    if (covered(stop) && centers.every(center => !overlap(area(stop), center))) markings.push(stop);
  }
  return { junctions, centers, markings };
}

/** A shared, connected service-road tree; existing buildings and roads are immutable. */
export function createBuildingAccessRoads(baseNetwork: UrbanRoadNetwork, warehouses: readonly AccessWarehouse[],
  boxes: readonly AccessSolid[], bounds: AccessBounds): BuildingAccessResult {
  if (!Object.values(bounds).every(Number.isFinite) || bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ)
    throw new RangeError('Invalid access-road bounds');
  const baseAreas = baseNetwork.surfaces.map(road => area(road));
  // Five metres of truck headroom; solid ground and overhead roofs/pipes do not block a street.
  const obstacles = boxes.filter(box => box.base < 7 && box.base + box.height > 2.2).map(box => area(box, 0.6, box.yaw));
  const startX = Math.ceil((bounds.minX + MARGIN) / STEP) * STEP;
  const startZ = Math.ceil((bounds.minZ + MARGIN) / STEP) * STEP;
  const columns = Math.floor((bounds.maxX - MARGIN - startX) / STEP) + 1;
  const rows = Math.floor((bounds.maxZ - MARGIN - startZ) / STEP) + 1, count = columns * rows;
  if (columns < 1 || rows < 1 || count > 1_000_000) throw new RangeError('Invalid access-road grid');
  const blocked = new Uint8Array(count), distance = new Int32Array(count), parent = new Int32Array(count);
  distance.fill(-1); parent.fill(-1);
  const point = (id: number): AccessPoint => ({ x: startX + id % columns * STEP, z: startZ + Math.floor(id / columns) * STEP });
  for (const obstacle of obstacles) {
    const minX = Math.max(0, Math.ceil((obstacle.minX - MARGIN + 0.6 - startX) / STEP));
    const maxX = Math.min(columns - 1, Math.floor((obstacle.maxX + MARGIN - 0.6 - startX) / STEP));
    const minZ = Math.max(0, Math.ceil((obstacle.minZ - MARGIN + 0.6 - startZ) / STEP));
    const maxZ = Math.min(rows - 1, Math.floor((obstacle.maxZ + MARGIN - 0.6 - startZ) / STEP));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) blocked[z * columns + x] = 1;
  }
  const queue = new Int32Array(count), queued = new Uint8Array(count), paved = new Uint8Array(count);
  const baseConnection = new Map<number, AccessPoint>(), trunkNext = new Map<number, number>();
  let head = 0, tail = 0, pending = 0;
  const enqueue = (id: number) => { if (!queued[id]) { queue[tail] = id; tail = (tail + 1) % count; pending++; queued[id] = 1; } };
  for (let id = 0; id < count; id++) {
    if (blocked[id]) continue;
    const p = point(id), roadIndex = baseAreas.findIndex(road => contains(road, p, WIDTH / 2));
    if (roadIndex >= 0) {
      const road = baseNetwork.surfaces[roadIndex];
      baseConnection.set(id, road.depth > road.width ? { x: road.x, z: p.z } : { x: p.x, z: road.z });
      paved[id] = 1; distance[id] = 0; enqueue(id);
    }
  }
  const flood = () => {
    while (pending) {
      const id = queue[head]; head = (head + 1) % count; pending--; queued[id] = 0;
      const x = id % columns, z = Math.floor(id / columns);
      for (const next of [x > 0 ? id - 1 : -1, x + 1 < columns ? id + 1 : -1,
        z > 0 ? id - columns : -1, z + 1 < rows ? id + columns : -1]) {
        if (next < 0 || blocked[next] || distance[next] >= 0 && distance[next] <= distance[id] + 1) continue;
        distance[next] = distance[id] + 1; parent[next] = id; enqueue(next);
      }
    }
  };
  flood();
  const clear = (rect: RoadRectangle, footway = false): boolean => {
    const a = area(rect);
    if (footway) {
      if (rect.width > rect.depth) { a.minZ -= 2; a.maxZ += 2; }
      else { a.minX -= 2; a.maxX += 2; }
    }
    return a.minX >= bounds.minX - EPS && a.maxX <= bounds.maxX + EPS && a.minZ >= bounds.minZ - EPS
      && a.maxZ <= bounds.maxZ + EPS && !obstacles.some(obstacle => overlap(a, obstacle));
  };
  const pathClear = (points: readonly AccessPoint[]): boolean => {
    for (let i = 1; i < points.length; i++) {
      const line = segment(points[i - 1], points[i]);
      if (line && !clear(rectangle(line), true)) return false;
      if (i + 1 < points.length) {
        const next = segment(points[i], points[i + 1]);
        if (line && next && line.axis !== next.axis && !clear({ ...points[i], width: 16, depth: 16 })) return false;
      }
    }
    return true;
  };
  const accesses: BuildingAccess[] = [], unreachable: number[] = [];
  for (const [buildingIndex, building] of warehouses.entries()) {
    let best: { door: AccessPoint; entry: AccessPoint; connector: AccessPoint[]; id: number; cost: number } | undefined;
    const yaw = building.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
    if (Math.abs(Math.sin(yaw * 2)) > EPS) throw new RangeError('Warehouse loading doors require a cardinal orientation');
    for (const side of [-1, 1]) for (const dx of [-building.width * 0.28, building.width * 0.28]) {
      const dz = side * building.depth / 2;
      const door = { x: building.x + dx * c + dz * s, z: building.z - dx * s + dz * c };
      const normal = { x: Math.abs(s) < EPS ? 0 : side * Math.round(s), z: Math.abs(c) < EPS ? 0 : side * Math.round(c) };
      const entry = { x: door.x + normal.x * 3.1, z: door.z + normal.z * 3.1 };
      const portal = { x: door.x + normal.x * 12.5, z: door.z + normal.z * 12.5 };
      const nearX = Math.round((portal.x - startX) / STEP), nearZ = Math.round((portal.z - startZ) / STEP);
      for (let z = nearZ - 2; z <= nearZ + 2; z++) for (let x = nearX - 2; x <= nearX + 2; x++) {
        if (x < 0 || x >= columns || z < 0 || z >= rows) continue;
        const id = z * columns + x;
        if (distance[id] < 0) continue;
        const node = point(id), cost = distance[id] * STEP + Math.abs(portal.x - node.x) + Math.abs(portal.z - node.z);
        if (best && cost >= best.cost) continue;
        for (const corner of [{ x: node.x, z: portal.z }, { x: portal.x, z: node.z }]) {
          const connector = [entry, portal, corner, node].filter((p, index, all) => index === 0
            || Math.abs(p.x - all[index - 1].x) > EPS || Math.abs(p.z - all[index - 1].z) > EPS);
          if (pathClear(connector)) { best = { door, entry, connector, id, cost }; break; }
        }
      }
    }
    if (!best) { unreachable.push(buildingIndex); continue; }
    const nodes = [best.id];
    while (parent[nodes[nodes.length - 1]] >= 0) nodes.push(parent[nodes[nodes.length - 1]]);
    while (trunkNext.has(nodes[nodes.length - 1])) nodes.push(trunkNext.get(nodes[nodes.length - 1])!);
    const points = [...best.connector, ...nodes.slice(1).map(point), baseConnection.get(nodes[nodes.length - 1])!]
      .filter((p, index, all) => index === 0 || Math.abs(p.x - all[index - 1].x) > EPS || Math.abs(p.z - all[index - 1].z) > EPS);
    accesses.push({ buildingIndex, label: building.label, door: best.door, entry: best.entry, points, surfaceIndices: [] });
    for (let i = 0; i < nodes.length; i++) if (!paved[nodes[i]]) {
      paved[nodes[i]] = 1;
      if (i + 1 < nodes.length) trunkNext.set(nodes[i], nodes[i + 1]);
      distance[nodes[i]] = 0; parent[nodes[i]] = -1; enqueue(nodes[i]);
    }
    flood();
  }
  const lines = mergeLines(accesses.flatMap(access => access.points.slice(1).flatMap((p, index) => {
    const line = segment(access.points[index], p); return line ? [line] : [];
  })));
  const serviceLines = lines.filter(line => !baseAreas.some(base => {
    const rect = rectangle(line);
    const a = area(rect); return base.minX <= a.minX + EPS && base.maxX >= a.maxX - EPS
      && base.minZ <= a.minZ + EPS && base.maxZ >= a.maxZ - EPS;
  }));
  const added = serviceLines.map(line => rectangle(line));
  const corners = new Map<string, RoadRectangle>();
  for (const access of accesses) for (let i = 1; i + 1 < access.points.length; i++) {
    const before = segment(access.points[i - 1], access.points[i]), after = segment(access.points[i], access.points[i + 1]);
    if (before && after && before.axis !== after.axis) {
      const p = access.points[i], rect = { ...p, width: WIDTH, depth: WIDTH };
      if (!baseAreas.some(base => contains(base, p, WIDTH / 2))) corners.set(`${p.x.toFixed(6)}:${p.z.toFixed(6)}`, rect);
    }
  }
  const surfaces = [...baseNetwork.surfaces, ...added, ...corners.values()];
  const pavedAreas = surfaces.map(surface => area(surface));
  const kerbs: RoadRectangle[] = baseNetwork.kerbs.flatMap(kerb => clip(kerb, surfaces.slice(baseNetwork.surfaces.length).map(rect => area(rect))));
  for (const line of serviceLines) for (const side of [-1, 1]) {
    const curb = rectangle({ ...line, coordinate: line.coordinate + side * 7 }, 1.6);
    kerbs.push(...clip(curb, pavedAreas).filter(piece => clear(piece)));
  }
  const junctions = junctionLayout(baseNetwork, serviceLines, surfaces);
  const intersections = [...baseNetwork.intersections, ...junctions.junctions];
  const crossingAreas = intersections.flatMap(junction => junction.crossings.map(crossing => area(crossing)));
  const markings: RoadMarking[] = baseNetwork.markings.flatMap(marking => clip(marking,
    marking.kind === 'zebra' ? junctions.centers : [...junctions.centers, ...crossingAreas]));
  for (const line of serviceLines) if (line.end - line.start >= 64) {
    for (let along = line.start + 18; along < line.end - 18; along += 18) {
      const dash: RoadMarking = line.axis === 'x'
        ? { kind: 'center', x: along, z: line.coordinate, width: 6, depth: 0.2 }
        : { kind: 'center', x: line.coordinate, z: along, width: 0.2, depth: 6 };
      // A base road already supplies its own lane markings in an overlap.
      if (!baseAreas.some(base => contains(base, dash)) && clear(dash)) markings.push(...clip(dash, [...junctions.centers, ...crossingAreas]));
    }
  }
  markings.push(...junctions.markings.filter(marking => marking.kind === 'zebra'
    || crossingAreas.every(crossing => !overlap(area(marking), crossing))));
  const network = { surfaces, kerbs: kerbs.flatMap(kerb => clip(kerb, [...junctions.centers, ...crossingAreas])),
    markings, intersections };
  for (const access of accesses) access.surfaceIndices = surfaces.flatMap((surface, index) =>
    access.points.some(p => contains(area(surface), p)) ? [index] : []);
  return { network, accesses, unreachable };
}
