import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Checkpoint } from './flight';
import {
  groundHeight, waterDistance, WATER_LEVEL, WORLD_BOUNDS, TERRAIN_SIZE, WORLD_CENTER_Z,
  RIVER_SAMPLES, LAKES, lakeBoundary,
} from './landscape.ts';
import { createWater } from './water.ts';
import { TARGETS } from './weapons.ts';

export { groundHeight } from './landscape.ts';

/** The first two gates share a straight, level approach for a gentle first flight. */
export const CHECKPOINTS: Checkpoint[] = [
  { position: { x: 0, y: 12, z: 5 }, yaw: 0, radius: 7.1 },
  { position: { x: 0, y: 12, z: -115 }, yaw: 0, radius: 7.1 },
  { position: { x: 80, y: 17, z: -230 }, yaw: -0.48, radius: 7.1 },
  { position: { x: 130, y: 25, z: -360 }, yaw: 0.38, radius: 7.1 },
  { position: { x: 20, y: 22, z: -455 }, yaw: 1.51, radius: 7.1 },
  { position: { x: -120, y: 18, z: -395 }, yaw: 2.5, radius: 7.1 },
  { position: { x: -145, y: 14, z: -205 }, yaw: -2.94, radius: 7.1 },
  { position: { x: -60, y: 12, z: -55 }, yaw: -2.51, radius: 7.1 },
];

export interface WorldObstacle {
  x: number;
  z: number;
  radius: number;
  height: number;
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

function numberTexture(number: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#23322c';
  context.fillRect(0, 0, 256, 128);
  context.fillStyle = '#edeee1';
  context.font = '600 68px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(number).padStart(2, '0'), 128, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#adcadf');
  scene.fog = new THREE.FogExp2('#b0c9d5', 0.00022);
  const geometryResources = new Set<THREE.BufferGeometry>();
  const materialResources = new Set<THREE.Material>();
  const textureResources = new Set<THREE.Texture>();
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometryResources.add(geometry);
    return geometry;
  };
  const ownMaterial = <T extends THREE.Material>(material: T): T => {
    materialResources.add(material);
    return material;
  };
  const random = randomGenerator(1074);
  const obstacles: WorldObstacle[] = [];
  const course = CHECKPOINTS.map(checkpoint => new THREE.Vector3(checkpoint.position.x, 0, checkpoint.position.z));
  const pathCurve = new THREE.CatmullRomCurve3(course, true, 'centripetal');
  const pathSamples = pathCurve.getPoints(280);
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

  scene.add(new THREE.HemisphereLight('#f3f5ed', '#59694b', 2.15));
  const sun = new THREE.DirectionalLight('#fff2d7', 2.55);
  sun.position.set(-180, 282, 235);
  sun.target.position.set(0, 0, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -270;
  sun.shadow.camera.right = 270;
  sun.shadow.camera.top = 270;
  sun.shadow.camera.bottom = -270;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 850;
  sun.shadow.normalBias = 0.55;
  sun.shadow.bias = -0.00025;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // A closed sky dome keeps upward views covered and places the distant alpine
  // panorama outside the playable terrain, with no visible cylinder rim.
  const panorama = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/alpine-panorama.jpg`);
  panorama.colorSpace = THREE.SRGBColorSpace;
  textureResources.add(panorama);
  const panoramaMesh = new THREE.Mesh(
    ownGeometry(new THREE.SphereGeometry(5400, 96, 48)),
    ownMaterial(new THREE.MeshBasicMaterial({ map: panorama, side: THREE.BackSide, fog: false, toneMapped: false })),
  );
  panoramaMesh.position.set(0, 0, WORLD_CENTER_Z);
  panoramaMesh.scale.y = 0.72;
  panoramaMesh.rotation.y = Math.PI / 2 + 0.13;
  scene.add(panoramaMesh);

  const grassTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/grass-texture.jpg`);
  grassTexture.colorSpace = THREE.SRGBColorSpace;
  grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(TERRAIN_SIZE / 13, TERRAIN_SIZE / 13);
  grassTexture.anisotropy = 8;
  textureResources.add(grassTexture);
  const subdivisions = 300;
  const terrainGeometry = ownGeometry(new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, subdivisions, subdivisions));
  terrainGeometry.rotateX(-Math.PI / 2);
  const terrainPositions = terrainGeometry.attributes.position;
  const terrainColors = new Float32Array(terrainPositions.count * 3);
  const heights = new Float32Array(terrainPositions.count);
  const waterDistances = new Float32Array(terrainPositions.count);
  const color = new THREE.Color();
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i);
    const z = terrainPositions.getZ(i) + WORLD_CENTER_Z;
    const height = groundHeight(x, z);
    terrainPositions.setXYZ(i, x, height, z);
    heights[i] = height;
    waterDistances[i] = waterDistance(x, z);
  }
  const rowSize = subdivisions + 1;
  const spacing = TERRAIN_SIZE / subdivisions;
  const rockTint = new THREE.Color('#c3c2b5');
  const beachTint = new THREE.Color('#d0c0a0');
  const bedTint = new THREE.Color('#84917d');
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i);
    const z = terrainPositions.getZ(i);
    const height = heights[i];
    const column = i % rowSize;
    const row = Math.floor(i / rowSize);
    const slopeX = (heights[i + (column < subdivisions ? 1 : 0)] - heights[i - (column > 0 ? 1 : 0)]) / spacing / 2;
    const slopeZ = (heights[i + (row < subdivisions ? rowSize : 0)] - heights[i - (row > 0 ? rowSize : 0)]) / spacing / 2;
    const slope = Math.hypot(slopeX, slopeZ);
    const meadowPatch = Math.sin(x * 0.0064 + 0.8) * Math.cos(z * 0.0051) * 0.095;
    const shade = 0.81 + meadowPatch + Math.sin((x - z) * 0.014) * 0.024;
    color.set('#bdc4a1').multiplyScalar(shade);
    color.lerp(rockTint, Math.min(0.78, Math.max(0, slope - 0.27) * 1.7 + Math.max(0, height - 220) / 720));
    if (waterDistances[i] < 20 && height < WATER_LEVEL + 8) {
      const shore = THREE.MathUtils.clamp((20 - waterDistances[i]) / 20, 0, 1);
      color.lerp(waterDistances[i] < -2 ? bedTint : beachTint, shore * 0.84);
    }
    terrainColors.set([color.r, color.g, color.b], i * 3);
  }
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3));
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, ownMaterial(new THREE.MeshStandardMaterial({
    map: grassTexture, vertexColors: true, roughness: 1, metalness: 0, flatShading: false,
  })));
  terrain.receiveShadow = true;
  scene.add(terrain);
  const water = createWater(panorama);
  scene.add(water.group);

  const buildPath = (points: THREE.Vector3[], width: number) => {
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const previous = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const length = Math.hypot(dx, dz) || 1;
      const taper = 0.84 + Math.sin(i * 0.7) * 0.11 + Math.sin(i * 0.22) * 0.13;
      const nx = -dz / length * width * taper * 0.5;
      const nz = dx / length * width * taper * 0.5;
      for (const side of [-1, 1]) {
        const x = point.x + nx * side;
        const z = point.z + nz * side;
        vertices.push(x, groundHeight(x, z) + 0.055, z);
        color.set('#989078').multiplyScalar(0.91 + random() * 0.16);
        colors.push(color.r, color.g, color.b);
      }
      if (i > 0) {
        const a = i * 2;
        indices.push(a - 2, a, a - 1, a - 1, a, a + 1);
      }
    }
    const geometry = ownGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, ownMaterial(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.52, depthWrite: false,
    })));
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  buildPath(pathSamples, 1.7);
  buildPath(Array.from({ length: 40 }, (_, i) => new THREE.Vector3(Math.sin(i * 0.21) * 1.15, 0, 75 - i * 3.15)), 1.65);

  // Crossed alpha-cut pine impostors retain the photo's fine branch silhouette
  // while the entire forest costs just two draw calls. Trunk collision remains
  // in world metres and is independent of the rendering representation.
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
    if (!clearTrainingGround(x, z, 5.5)) continue;
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
  const pineTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/pine-tree.png`);
  pineTexture.colorSpace = THREE.SRGBColorSpace;
  pineTexture.anisotropy = 4;
  textureResources.add(pineTexture);
  const pineGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
  const pineMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    map: pineTexture, alphaTest: 0.45, side: THREE.DoubleSide, toneMapped: false,
  }));
  const pinePlanes = Array.from({ length: 2 }, () => {
    const mesh = new THREE.InstancedMesh(pineGeometry, pineMaterial, treeData.length);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  });
  treeData.forEach((tree, index) => {
    for (let plane = 0; plane < pinePlanes.length; plane++) {
      transform.position.set(tree.x, tree.y + tree.height * 0.5, tree.z);
      transform.rotation.set(0, tree.angle + plane * Math.PI / 2, 0);
      transform.scale.set(tree.width, tree.height, 1);
      transform.updateMatrix();
      pinePlanes[plane].setMatrixAt(index, transform.matrix);
      color.setRGB(0.81 + tree.shade * 0.18, 0.86 + tree.shade * 0.13, 0.78 + tree.shade * 0.18);
      pinePlanes[plane].setColorAt(index, color);
    }
  });

  const rawRockGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const rockPositions = rawRockGeometry.attributes.position;
  for (let i = 0; i < rockPositions.count; i++) {
    const x = rockPositions.getX(i);
    const y = rockPositions.getY(i);
    const z = rockPositions.getZ(i);
    const distortion = 0.92 + Math.sin(x * 7.1 + z * 4.8) * Math.cos(y * 6.7 - z * 2.4) * 0.15;
    rockPositions.setXYZ(i, x * distortion, y * (0.91 + Math.sin(z * 7.3 + x * 3.1) * 0.12), z * distortion);
  }
  rawRockGeometry.deleteAttribute('normal');
  rawRockGeometry.deleteAttribute('uv');
  const rockGeometry = ownGeometry(mergeVertices(rawRockGeometry));
  rockGeometry.computeVertexNormals();
  const rockMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#a6aca1', roughness: 1, flatShading: false }));
  const rockCount = 1150;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  let rockIndex = 0;
  for (let attempt = 0; attempt < 7200 && rockIndex < rockCount; attempt++) {
    const nearCourse = random() < 0.18;
    const x = nearCourse ? (random() - 0.5) * 850 : WORLD_BOUNDS.minX + random() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX);
    const z = nearCourse ? random() * 950 - 715 : WORLD_BOUNDS.minZ + random() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);
    if (waterDistance(x, z) < 3) continue;
    if (distanceFromCourse(x, z) < 10.5) continue;
    if (!clearTrainingGround(x, z, 3)) continue;
    const size = 0.65 + random() * 4.9;
    const height = size * (0.48 + random() * 0.65);
    transform.position.set(x, groundHeight(x, z) + height * 0.36, z);
    transform.rotation.set(random(), random() * 6, random());
    transform.scale.set(size, height, size * (0.75 + random() * 0.7));
    transform.updateMatrix();
    rocks.setMatrixAt(rockIndex, transform.matrix);
    color.set('#93978d').multiplyScalar(0.9 + random() * 0.32);
    rocks.setColorAt(rockIndex, color);
    obstacles.push({ x, z, radius: size * 0.85, height: height * 1.25 });
    rockIndex++;
  }
  rocks.count = rockIndex;
  scene.add(rocks);

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
  const bankStones = new THREE.InstancedMesh(rockGeometry, rockMaterial, bankStoneCount);
  bankStones.castShadow = true;
  bankStones.receiveShadow = true;
  let bankStoneIndex = 0;
  for (let attempt = 0; attempt < 6400 && bankStoneIndex < bankStoneCount; attempt++) {
    const point = sampleBank(0.5 + random() * 12);
    const distance = waterDistance(point.x, point.z);
    if (!insideBounds(point.x, point.z, 10) || distance < -0.5 || distance > 20) continue;
    if (distanceFromCourse(point.x, point.z) < 10 || !clearTrainingGround(point.x, point.z, 3)) continue;
    const size = 0.45 + random() * 2.2;
    const height = size * (0.36 + random() * 0.37);
    transform.position.set(point.x, groundHeight(point.x, point.z) + height * 0.27, point.z);
    transform.rotation.set(random() * 0.5, random() * Math.PI, random() * 0.4);
    transform.scale.set(size, height, size * (0.8 + random() * 0.45));
    transform.updateMatrix();
    bankStones.setMatrixAt(bankStoneIndex, transform.matrix);
    color.set('#9eaa9d').lerp(new THREE.Color('#d0cbbb'), random() * 0.7);
    bankStones.setColorAt(bankStoneIndex, color);
    obstacles.push({ x: point.x, z: point.z, radius: size * 0.82, height: height * 1.15 });
    bankStoneIndex++;
  }
  bankStones.count = bankStoneIndex;
  scene.add(bankStones);

  const shrubGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const shrubMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }));
  const shrubCount = 660;
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubCount * 3);
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  let shrubIndex = 0;
  for (let attempt = 0; attempt < 6200 && shrubIndex < shrubCount; attempt++) {
    const point = sampleBank(5 + random() * 21);
    const distance = waterDistance(point.x, point.z);
    if (!insideBounds(point.x, point.z, 20) || distance < 3 || distance > 38) continue;
    if (distanceFromCourse(point.x, point.z) < 12 || !clearTrainingGround(point.x, point.z, 5)) continue;
    const height = 0.7 + random() * 1.9;
    const y = groundHeight(point.x, point.z);
    for (let leaf = 0; leaf < 3; leaf++) {
      const angle = leaf * Math.PI * 2 / 3 + shrubIndex;
      const width = height * (0.62 + random() * 0.32);
      transform.position.set(point.x + Math.cos(angle) * height * 0.35, y + height * (0.37 + leaf * 0.09), point.z + Math.sin(angle) * height * 0.35);
      transform.rotation.set(0, random() * Math.PI, random() * 0.1);
      transform.scale.set(width, height * (0.49 + leaf * 0.08), width * 0.85);
      transform.updateMatrix();
      shrubs.setMatrixAt(shrubIndex * 3 + leaf, transform.matrix);
      color.set('#536d40').lerp(new THREE.Color('#8b9460'), random() * 0.68);
      shrubs.setColorAt(shrubIndex * 3 + leaf, color);
    }
    shrubIndex++;
  }
  shrubs.count = shrubIndex * 3;
  scene.add(shrubs);

  const ringGeometry = ownGeometry(new THREE.TorusGeometry(7.5, 0.34, 10, 100));
  const accentGeometry = ownGeometry(new THREE.TorusGeometry(7.5, 0.354, 10, 7, 0.235));
  const highlightGeometry = ownGeometry(new THREE.TorusGeometry(7.11, 0.071, 7, 100));
  const ringMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#efecdf', roughness: 0.49, metalness: 0.12 }));
  const orangeMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#e78332', roughness: 0.57, metalness: 0.05 }));
  const highlightMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#d5ec58', emissive: '#bad946', emissiveIntensity: 0.68, roughness: 0.6,
  }));
  const supportGeometry = ownGeometry(new THREE.CylinderGeometry(0.13, 0.16, 1, 8));
  const supportMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#48524b', metalness: 0.55, roughness: 0.48 }));
  const baseGeometry = ownGeometry(new THREE.BoxGeometry(1.5, 0.35, 1.5));
  const baseMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#8a9285', roughness: 0.9 }));
  const signGeometry = ownGeometry(new THREE.PlaneGeometry(2.3, 1.15));
  const highlights: THREE.Mesh[] = [];
  CHECKPOINTS.forEach((checkpoint, index) => {
    const gate = new THREE.Group();
    gate.position.set(checkpoint.position.x, checkpoint.position.y, checkpoint.position.z);
    gate.rotation.y = checkpoint.yaw;
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.castShadow = true;
    gate.add(ring);
    for (let stripe = 0; stripe < 4; stripe++) {
      const accent = new THREE.Mesh(accentGeometry, orangeMaterial);
      accent.rotation.z = stripe * Math.PI / 2 - 0.235 / 2;
      gate.add(accent);
    }
    const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
    highlight.visible = index === 0;
    highlights.push(highlight);
    gate.add(highlight);
    for (const side of [-1, 1]) {
      const localX = side * 4.75;
      const localTop = -5.65;
      const worldX = checkpoint.position.x + localX * Math.cos(checkpoint.yaw);
      const worldZ = checkpoint.position.z - localX * Math.sin(checkpoint.yaw);
      const localGround = groundHeight(worldX, worldZ) - checkpoint.position.y;
      const supportHeight = localTop - localGround;
      const support = new THREE.Mesh(supportGeometry, supportMaterial);
      support.position.set(localX, localGround + supportHeight / 2, 0);
      support.scale.y = supportHeight;
      support.rotation.z = side * -0.045;
      support.castShadow = true;
      gate.add(support);
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      base.position.set(localX, localGround + 0.17, 0);
      base.receiveShadow = true;
      gate.add(base);
    }
    const texture = numberTexture(index + 1);
    textureResources.add(texture);
    const sign = new THREE.Mesh(signGeometry, ownMaterial(new THREE.MeshStandardMaterial({
      map: texture, roughness: 0.8, side: THREE.DoubleSide,
    })));
    sign.position.set(0, -8.9, 0.16);
    gate.add(sign);
    scene.add(gate);
  });

  // Small stone trail markers make the route readable below the aircraft.
  const markerGeometry = ownGeometry(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 6));
  const markers = new THREE.InstancedMesh(markerGeometry, ownMaterial(new THREE.MeshStandardMaterial({ color: '#d8d5bc', roughness: 0.85 })), 58);
  for (let i = 0; i < 58; i++) {
    const sample = pathCurve.getPoint(i / 58);
    const tangent = pathCurve.getTangent(i / 58);
    const x = sample.x - tangent.z * 3.6;
    const z = sample.z + tangent.x * 3.6;
    transform.position.set(x, groundHeight(x, z) + 0.6, z);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    markers.setMatrixAt(i, transform.matrix);
  }
  scene.add(markers);

  let disposed = false;
  return {
    scene,
    obstacles,
    update(time: number, nextCheckpoint: number, focus?: { x: number; y: number; z: number }) {
      water.update(time);
      if (focus) {
        sun.position.set(focus.x - 180, focus.y + 270, focus.z + 180);
        sun.target.position.set(focus.x, focus.y - 12, focus.z);
        sun.target.updateMatrixWorld();
      }
      highlights.forEach((highlight, index) => {
        highlight.visible = index === nextCheckpoint;
        if (highlight.visible) highlight.scale.setScalar(1 + Math.sin(time * 1.8) * 0.0025);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      water.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      for (const geometry of geometryResources) geometry.dispose();
      for (const material of materialResources) material.dispose();
      for (const texture of textureResources) texture.dispose();
      sun.shadow.map?.dispose();
      scene.clear();
    },
  };
}
