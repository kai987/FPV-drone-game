import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Checkpoint } from './flight';
import {
  WATER_LEVEL, TERRAIN_SIZE, WORLD_CENTER_Z,
} from './landscape.ts';
import { createWater } from './water.ts';
import { createRockMaterial } from './rock-material.ts';
import { createNightSky } from './night-sky.ts';
import { createRural } from './rural.ts';
import { createShrubs } from './shrubs.ts';
import { TARGETS } from './weapons.ts';
import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';
import { createSceneSimulation } from './scene-simulation.ts';

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
  /** Optional absolute bottom for elevated bridge rails and beams. */
  base?: number;
  roof?: boolean;
}

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
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

export function createWorld(runtime: RustRuntime, kernel: WorldKernel) {
  const groundHeight = (x: number, z: number) => kernel.groundHeight(x, z);
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
  const sceneData = createSceneSimulation(runtime, kernel, pathSamples, TARGETS, (pathSamples.length + 40) * 2);

  const hemisphere = new THREE.HemisphereLight('#f3f5ed', '#59694b', 2.15);
  scene.add(hemisphere);
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
  const nightSky = createNightSky();
  scene.add(nightSky.group);

  const grassTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/grass-texture.jpg`);
  grassTexture.colorSpace = THREE.SRGBColorSpace;
  grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(TERRAIN_SIZE / 13, TERRAIN_SIZE / 13);
  grassTexture.anisotropy = 8;
  textureResources.add(grassTexture);
  const rockTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/weathered-rock.jpg`);
  rockTexture.colorSpace = THREE.SRGBColorSpace;
  rockTexture.wrapS = rockTexture.wrapT = THREE.RepeatWrapping;
  rockTexture.anisotropy = 8;
  textureResources.add(rockTexture);
  const subdivisions = 300;
  const terrainGeometry = ownGeometry(new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, subdivisions, subdivisions));
  terrainGeometry.rotateX(-Math.PI / 2);
  const terrainPositions = terrainGeometry.attributes.position;
  const terrainSamplePoints = new Float32Array(terrainPositions.count * 2);
  for (let i = 0; i < terrainPositions.count; i++) {
    terrainSamplePoints[i * 2] = terrainPositions.getX(i);
    terrainSamplePoints[i * 2 + 1] = terrainPositions.getZ(i) + WORLD_CENTER_Z;
  }
  const { heights, waterDistances } = kernel.sampleTerrain(terrainSamplePoints);
  for (let i = 0; i < terrainPositions.count; i++) terrainPositions.setXYZ(i, terrainSamplePoints[i * 2], heights[i], terrainSamplePoints[i * 2 + 1]);
  const terrainColors = sceneData.terrainColors(terrainSamplePoints, heights, waterDistances, subdivisions, TERRAIN_SIZE / subdivisions);
  const color = new THREE.Color();
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3));
  terrainGeometry.computeVertexNormals();
  const terrainMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    map: grassTexture, vertexColors: true, roughness: 1, metalness: 0, flatShading: false,
  }));
  terrainMaterial.onBeforeCompile = shader => {
    shader.uniforms.riverBedMap = { value: rockTexture };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      varying vec3 terrainPoint;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      terrainPoint = position;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform sampler2D riverBedMap;
      varying vec3 terrainPoint;
    `).replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 grass = texture2D(map, vMapUv);
        vec3 stone = texture2D(riverBedMap, terrainPoint.xz * 0.55).rgb;
        vec3 sediment = mix(stone * vec3(0.46, 0.46, 0.35), vec3(0.085, 0.095, 0.070), 0.32);
        float submerged = 1.0 - smoothstep(${(WATER_LEVEL - 0.55).toFixed(2)}, ${(WATER_LEVEL + 0.15).toFixed(2)}, terrainPoint.y);
        diffuseColor *= vec4(mix(grass.rgb, sediment, submerged), grass.a);
      #endif
    `);
  };
  terrainMaterial.customProgramCacheKey = () => 'grass-and-stony-river-bed-v1';
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true;
  scene.add(terrain);
  const water = createWater(panorama, sceneData, terrainSamplePoints, heights);
  scene.add(water.group);
  const rural = createRural(runtime, kernel);
  scene.add(rural.group);
  obstacles.push(...rural.obstacles);

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
  const treeData = sceneData.placements.trees;
  for (const tree of treeData) obstacles.push({ x: tree.x, z: tree.z, radius: 0.35 + tree.height * 0.016, height: tree.height });
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

  const rawRockGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 2));
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
  const rockMaterial = ownMaterial(createRockMaterial(rockTexture));
  const rockCount = sceneData.placements.rocks.length;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  sceneData.placements.rocks.forEach((rock, index) => {
    transform.position.set(rock.x, rock.y, rock.z); transform.rotation.set(rock.rotation[0], rock.rotation[1], rock.rotation[2]);
    transform.scale.set(rock.scale[0], rock.scale[1], rock.scale[2]); transform.updateMatrix(); rocks.setMatrixAt(index, transform.matrix);
    color.set('#f4f2e7').multiplyScalar(rock.tint); rocks.setColorAt(index, color);
    obstacles.push({ x: rock.x, z: rock.z, radius: rock.radius, height: rock.height });
  });
  rocks.count = sceneData.placements.rocks.length;
  scene.add(rocks);

  // Broken stone shelves and low willow-like clumps soften the shore without
  // imposing a regular fence or covering the river with vegetation.
  const bankStoneCount = sceneData.placements.banks.length;
  const bankStones = new THREE.InstancedMesh(rockGeometry, rockMaterial, bankStoneCount);
  bankStones.castShadow = true;
  bankStones.receiveShadow = true;
  const bankTint = new THREE.Color('#f5efdf');
  sceneData.placements.banks.forEach((stone, index) => {
    transform.position.set(stone.x, stone.y, stone.z); transform.rotation.set(stone.rotation[0], stone.rotation[1], stone.rotation[2]);
    transform.scale.set(stone.scale[0], stone.scale[1], stone.scale[2]); transform.updateMatrix(); bankStones.setMatrixAt(index, transform.matrix);
    color.set('#b7bdac').lerp(bankTint, stone.tint); bankStones.setColorAt(index, color);
    obstacles.push({ x: stone.x, z: stone.z, radius: stone.radius, height: stone.height });
  });
  bankStones.count = sceneData.placements.banks.length;
  scene.add(bankStones);

  const shrubs = createShrubs(sceneData.placements.shrubs);
  scene.add(shrubs.group);
  sceneData.dispose();

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
  let nightMode = false;
  return {
    scene,
    obstacles,
    setNight(enabled: boolean) {
      nightMode = enabled;
      scene.background = new THREE.Color(enabled ? '#091425' : '#adcadf');
      scene.fog = new THREE.FogExp2(enabled ? '#101e32' : '#b0c9d5', enabled ? 0.00030 : 0.00022);
      hemisphere.color.set(enabled ? '#94b2db' : '#f3f5ed');
      hemisphere.groundColor.set(enabled ? '#1f2a33' : '#59694b');
      hemisphere.intensity = enabled ? 0.65 : 2.15;
      sun.color.set(enabled ? '#a2c1ef' : '#fff2d7');
      sun.intensity = enabled ? 1.0 : 2.55;
      panoramaMesh.material.color.set(enabled ? '#142439' : '#ffffff');
      pineMaterial.color.set(enabled ? '#647f9b' : '#ffffff');
      ringMaterial.emissive.set(enabled ? '#45586c' : '#000000');
      ringMaterial.emissiveIntensity = enabled ? 0.65 : 0;
      nightSky.setNight(enabled);
      water.setNight(enabled);
      rural.setNight(enabled);
    },
    update(time: number, nextCheckpoint: number, focus?: { x: number; y: number; z: number }) {
      water.update(time);
      rural.update(time);
      shrubs.update(time);
      if (focus) {
        sun.position.set(focus.x - 180, focus.y + (nightMode ? 210 : 270), focus.z + (nightMode ? -330 : 180));
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
      rural.dispose();
      shrubs.dispose();
      nightSky.dispose();
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
