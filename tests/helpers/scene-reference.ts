// Frozen pre-migration scene-generation algorithm, independent of Rust.
import * as THREE from 'three';
import { groundHeight, waterDistance, WORLD_BOUNDS, LAKES, RIVER_SAMPLES, lakeBoundary } from '../../src/game/landscape.ts';
import { clearance } from '../../src/game/rural-layout.ts';
import { TARGETS } from '../../src/game/weapons.ts';
import type { WorldObstacle } from '../../src/game/world.ts';

function recorder() {
  const matrices: number[][] = []; const colors: number[][] = [];
  return { matrices, colors, count: 0, castShadow: false, receiveShadow: false,
    setMatrixAt(index: number, value: THREE.Matrix4) { matrices[index] = value.elements.slice(); },
    setColorAt(index: number, color: THREE.Color) { colors[index] = color.toArray(); } };
}
function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function segmentDistance(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}


export function referenceScene(pathSamples: THREE.Vector3[], randomSkip: number) {
  const random = randomGenerator(1074); for (let i=0;i<randomSkip;i++) random();
  const obstacles: WorldObstacle[] = []; const color = new THREE.Color();
  const approachStart = new THREE.Vector3(0, 0, 75);
  const approachEnd = new THREE.Vector3(0, 0, -140);
  const distanceFromCourse = (x: number, z: number) => {
    if (Math.abs(x) > 245 || z < -560 || z > 130) return Number.POSITIVE_INFINITY;
    let distance = segmentDistance(x, z, approachStart, approachEnd);
    for (let i = 0; i < pathSamples.length - 1; i++) {
      distance = Math.min(distance, segmentDistance(x, z, pathSamples[i], pathSamples[i + 1]));
    }
    return distance;
  };

  const treeData: { x: number; z: number; y: number; height: number; width: number; angle: number; shade: number }[] = [];
  const clusters = [
    { x: -280, z: -150, radius: 185 },
    { x: 315, z: -335, radius: 210 },
    { x: -420, z: 285, radius: 240 },
    ...Array.from({ length: 31 }, () => ({
      x: WORLD_BOUNDS.minX + 140 + random() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX - 280),
      z: WORLD_BOUNDS.minZ + 140 + random() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ - 280),
      radius: 130 + random() * 185,
    })),
  ];
  const insideBounds = (x: number, z: number, margin = 0) => x > WORLD_BOUNDS.minX + margin && x < WORLD_BOUNDS.maxX - margin
    && z > WORLD_BOUNDS.minZ + margin && z < WORLD_BOUNDS.maxZ - margin;
  const clearTrainingGround = (x: number, z: number, clearance: number) => TARGETS.every(target =>
    Math.hypot(x - target.position.x, z - target.position.z) > target.radius + clearance);
  for (let attempt = 0; attempt < 27000 && treeData.length < 5200; attempt++) {
    const clustered = random() < 0.8;
    const cluster = clusters[Math.floor(random() * clusters.length)];
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * cluster.radius;
    const x = clustered ? cluster.x + Math.cos(angle) * radius : WORLD_BOUNDS.minX + random() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX);
    const z = clustered ? cluster.z + Math.sin(angle) * radius : WORLD_BOUNDS.minZ + random() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);
    if (!insideBounds(x, z, 35)) continue;
    if (distanceFromCourse(x, z) < 13.5) continue;
    if (Math.hypot(x, z - 55) < 24) continue;
    if (!clearTrainingGround(x, z, 5.5) || !clearance(x, z, 9)) continue;
    if (waterDistance(x, z) < 8) continue;
    const meadow = Math.sin(x * 0.0038 + 0.4) * Math.cos(z * 0.0047 - 0.7);
    if (!clustered && meadow > 0.18 && random() < 0.83) continue;
    const y = groundHeight(x, z);
    const alpineScale = 1 - Math.min(0.42, Math.max(0, y - 200) / 1100);
    const height = (10 + random() * 25 + (clustered ? 4 : 0)) * alpineScale;
    treeData.push({ x, z, y, height, width: height * (0.44 + random() * 0.09), angle: random() * Math.PI * 2, shade: random() });
    obstacles.push({ x, z, radius: 0.35 + height * 0.016, height });
  }

  const transform = new THREE.Object3D();
  const rockCount = 1150;
  const rocks = recorder();
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  let rockIndex = 0;
  for (let attempt = 0; attempt < 7200 && rockIndex < rockCount; attempt++) {
    const nearCourse = random() < 0.18;
    const x = nearCourse ? (random() - 0.5) * 850 : WORLD_BOUNDS.minX + random() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX);
    const z = nearCourse ? random() * 950 - 715 : WORLD_BOUNDS.minZ + random() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);
    if (waterDistance(x, z) < 3) continue;
    if (distanceFromCourse(x, z) < 10.5) continue;
    if (!clearTrainingGround(x, z, 3) || !clearance(x, z, 6)) continue;
    const size = 0.65 + random() * 4.9;
    const height = size * (0.48 + random() * 0.65);
    transform.position.set(x, groundHeight(x, z) + height * 0.36, z);
    transform.rotation.set(random(), random() * 6, random());
    transform.scale.set(size, height, size * (0.75 + random() * 0.7));
    transform.updateMatrix();
    rocks.setMatrixAt(rockIndex, transform.matrix);
    color.set('#f4f2e7').multiplyScalar(0.84 + random() * 0.23);
    rocks.setColorAt(rockIndex, color);
    obstacles.push({ x, z, radius: size * 0.85, height: height * 1.25 });
    rockIndex++;
  }
  rocks.count = rockIndex;
  const lakeEdges = LAKES.map(lake => ({ lake, boundary: lakeBoundary(lake, 128) }));
  const sampleBank = (margin: number) => {
    if (random() < 0.64) {
      const index = Math.floor(random() * RIVER_SAMPLES.length);
      const point = RIVER_SAMPLES[index];
      const before = RIVER_SAMPLES[Math.max(0, index - 1)];
      const after = RIVER_SAMPLES[Math.min(RIVER_SAMPLES.length - 1, index + 1)];
      const dx = after.x - before.x;
      const dz = after.z - before.z;
      const length = Math.hypot(dx, dz) || 1;
      const side = random() < 0.5 ? -1 : 1;
      return { x: point.x - dz / length * (point.halfWidth + margin) * side, z: point.z + dx / length * (point.halfWidth + margin) * side };
    }
    const edge = lakeEdges[Math.floor(random() * lakeEdges.length)];
    const point = edge.boundary[Math.floor(random() * edge.boundary.length)];
    const dx = point.x - edge.lake.x;
    const dz = point.z - edge.lake.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: point.x + dx / length * margin, z: point.z + dz / length * margin };
  };

  // Broken stone shelves and low willow-like clumps soften the shore without
  // imposing a regular fence or covering the river with vegetation.
  const bankStoneCount = 720;
  const bankStones = recorder();
  bankStones.castShadow = true;
  bankStones.receiveShadow = true;
  let bankStoneIndex = 0;
  for (let attempt = 0; attempt < 6400 && bankStoneIndex < bankStoneCount; attempt++) {
    const point = sampleBank(0.5 + random() * 12);
    const distance = waterDistance(point.x, point.z);
    if (!insideBounds(point.x, point.z, 10) || distance < -0.5 || distance > 20) continue;
    if (distanceFromCourse(point.x, point.z) < 10 || !clearTrainingGround(point.x, point.z, 3) || !clearance(point.x, point.z, 3)) continue;
    const size = 0.45 + random() * 2.2;
    const height = size * (0.36 + random() * 0.37);
    transform.position.set(point.x, groundHeight(point.x, point.z) + height * 0.27, point.z);
    transform.rotation.set(random() * 0.5, random() * Math.PI, random() * 0.4);
    transform.scale.set(size, height, size * (0.8 + random() * 0.45));
    transform.updateMatrix();
    bankStones.setMatrixAt(bankStoneIndex, transform.matrix);
    color.set('#b7bdac').lerp(new THREE.Color('#f5efdf'), random() * 0.7);
    bankStones.setColorAt(bankStoneIndex, color);
    obstacles.push({ x: point.x, z: point.z, radius: size * 0.82, height: height * 1.15 });
    bankStoneIndex++;
  }
  bankStones.count = bankStoneIndex;


  const shrubCount = 420;
  const shrubPlacements: Array<{ x: number; y: number; z: number; height: number; seed: number }> = [];
  for (let attempt = 0; attempt < 6200 && shrubPlacements.length < shrubCount; attempt++) {
    const point = sampleBank(5 + random() * 21);
    const distance = waterDistance(point.x, point.z);
    if (!insideBounds(point.x, point.z, 20) || distance < 3 || distance > 38) continue;
    if (distanceFromCourse(point.x, point.z) < 12 || !clearTrainingGround(point.x, point.z, 5) || !clearance(point.x, point.z, 4)) continue;
    const height = 0.7 + random() * 1.9;
    shrubPlacements.push({ x: point.x, y: groundHeight(point.x, point.z), z: point.z, height, seed: shrubPlacements.length + 127 });
  }

  return { trees:treeData, rocks, banks:bankStones, shrubs:shrubPlacements, obstacles };
}
