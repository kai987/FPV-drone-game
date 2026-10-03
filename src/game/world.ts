import * as THREE from 'three';
import type { Checkpoint } from './flight';

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

export function groundHeight(x: number, z: number): number {
  const valleySides = Math.max(0, Math.abs(x) - 172);
  const valleyEnds = Math.max(0, Math.abs(z + 230) - 355);
  return 0.55 + Math.sin(x * 0.014) * Math.cos(z * 0.011) * 1.05
    + Math.sin((x + z) * 0.019) * 0.7
    + valleySides * valleySides * 0.0002875 + valleyEnds * valleyEnds * 0.000175;
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
  scene.fog = new THREE.FogExp2('#b0c9d5', 0.00105);
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
    let distance = segmentDistance(x, z, approachStart, approachEnd);
    for (let i = 0; i < pathSamples.length - 1; i++) {
      distance = Math.min(distance, segmentDistance(x, z, pathSamples[i], pathSamples[i + 1]));
    }
    return distance;
  };

  scene.add(new THREE.HemisphereLight('#f3f5ed', '#59694b', 2.15));
  const sun = new THREE.DirectionalLight('#fff2d7', 2.55);
  sun.position.set(-180, 270, 180);
  sun.target.position.set(0, 0, -180);
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
    ownGeometry(new THREE.SphereGeometry(1350, 96, 48)),
    ownMaterial(new THREE.MeshBasicMaterial({ map: panorama, side: THREE.BackSide, fog: false, toneMapped: false })),
  );
  panoramaMesh.position.set(0, 0, -230);
  panoramaMesh.scale.y = 0.72;
  panoramaMesh.rotation.y = Math.PI / 2 + 0.13;
  scene.add(panoramaMesh);

  const grassTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/grass-texture.jpg`);
  grassTexture.colorSpace = THREE.SRGBColorSpace;
  grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(92, 95);
  grassTexture.anisotropy = 8;
  textureResources.add(grassTexture);
  const terrainGeometry = ownGeometry(new THREE.PlaneGeometry(1450, 1500, 145, 150));
  terrainGeometry.rotateX(-Math.PI / 2);
  const terrainPositions = terrainGeometry.attributes.position;
  const terrainColors = new Float32Array(terrainPositions.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i);
    const z = terrainPositions.getZ(i) - 230;
    const height = groundHeight(x, z);
    terrainPositions.setXYZ(i, x, height, z);
    const shade = 0.83 + Math.sin(x * 0.024 + z * 0.03) * 0.085 + random() * 0.07;
    color.set('#c2c2a9').multiplyScalar(shade);
    terrainColors.set([color.r, color.g, color.b], i * 3);
  }
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainColors, 3));
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, ownMaterial(new THREE.MeshStandardMaterial({
    map: grassTexture, vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
  })));
  terrain.receiveShadow = true;
  scene.add(terrain);

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
      const taper = 0.88 + Math.sin(i * 0.7) * 0.12;
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
      vertexColors: true, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.82, depthWrite: false,
    })));
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  buildPath(pathSamples, 2.8);
  buildPath(Array.from({ length: 32 }, (_, i) => new THREE.Vector3(0, 0, 75 - i * 3.9)), 2.8);

  // Crossed alpha-cut pine impostors retain the photo's fine branch silhouette
  // while the entire forest costs just two draw calls. Trunk collision remains
  // in world metres and is independent of the rendering representation.
  const treeData: { x: number; z: number; y: number; height: number; width: number; angle: number; shade: number }[] = [];
  for (let attempt = 0; attempt < 3500 && treeData.length < 1020; attempt++) {
    const x = (random() - 0.5) * 1170;
    const z = random() * 1230 - 870;
    if (distanceFromCourse(x, z) < 13.5) continue;
    if (Math.hypot(x, z - 55) < 24) continue;
    const height = 12 + random() * 18;
    const y = groundHeight(x, z);
    treeData.push({ x, z, y, height, width: height * (0.44 + random() * 0.09), angle: random() * Math.PI * 2, shade: random() });
    if (Math.abs(x) < 275 && z > -610 && z < 160) obstacles.push({ x, z, radius: 0.6, height });
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

  const rockGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const rockMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#a5a99d', roughness: 0.97, flatShading: true }));
  const rockCount = 360;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  let rockIndex = 0;
  for (let attempt = 0; attempt < 1800 && rockIndex < rockCount; attempt++) {
    const x = (random() - 0.5) * 830;
    const z = random() * 950 - 715;
    if (distanceFromCourse(x, z) < 10.5) continue;
    const size = 0.7 + random() * 3.7;
    const height = size * (0.48 + random() * 0.65);
    transform.position.set(x, groundHeight(x, z) + height * 0.36, z);
    transform.rotation.set(random(), random() * 6, random());
    transform.scale.set(size, height, size * (0.75 + random() * 0.7));
    transform.updateMatrix();
    rocks.setMatrixAt(rockIndex, transform.matrix);
    color.set('#93978d').multiplyScalar(0.9 + random() * 0.32);
    rocks.setColorAt(rockIndex, color);
    if (Math.abs(x) < 275 && z > -610 && z < 160) obstacles.push({ x, z, radius: size * 0.85, height: height * 1.25 });
    rockIndex++;
  }
  rocks.count = rockIndex;
  scene.add(rocks);

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
    update(time: number, nextCheckpoint: number) {
      highlights.forEach((highlight, index) => {
        highlight.visible = index === nextCheckpoint;
        if (highlight.visible) highlight.scale.setScalar(1 + Math.sin(time * 1.8) * 0.0025);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
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
