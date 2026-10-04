import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { groundHeight } from './landscape.ts';
import { BRIDGES, CABINS, PASTURES, bridgeDeckY, bridgePoint } from './rural-layout.ts';

import { createLivestock } from './livestock.ts';
import { createFish } from './fish.ts';
import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';

type Triple = [number, number, number];
interface RuralObstacle { x: number; z: number; radius: number; height: number; base?: number; roof?: boolean }
interface Batch { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; mesh?: THREE.InstancedMesh }
/** Native rural geometry, batched livestock and fish; local surfaces live in rural-layout. */
export function createRural(runtime?: RustRuntime, world?: WorldKernel) {
  const groundHeightAt = world ? (x: number, z: number) => world.groundHeight(x, z) : groundHeight;
  const group = new THREE.Group();
  group.name = 'River village and pasture';
  const obstacles: RuralObstacle[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
  const ownMaterial = <T extends THREE.Material>(material: T) => { materials.add(material); return material; };
  const matte = (color: string, roughness = 0.8) => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness }));
  const wood = matte('#765039');
  const woodLight = matte('#a47a4e');
  const wall = matte('#dad2b7');
  const masonry = matte('#948b7a');
  const roof = matte('#745b4d');
  const roofEdge = matte('#4b463b');
  const dark = matte('#26332c');
  const windows = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#78908d', emissive: '#ffd492', emissiveIntensity: 0.025, metalness: 0.16, roughness: 0.25,
  }));
  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const roundedBox = ownGeometry(new RoundedBoxGeometry(1, 1, 1, 2, 0.13));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 10));
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-0.5, 0); gableShape.lineTo(0.5, 0); gableShape.lineTo(0, 1); gableShape.closePath();
  const gableGeometry = ownGeometry(new THREE.ExtrudeGeometry(gableShape, { depth: 1, bevelEnabled: false }));
  const staticBatches = new Map<string, Batch>();
  const local = new THREE.Object3D();
  const root = new THREE.Object3D();
  const getBatch = (collection: Map<string, Batch>, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const key = `${geometry.uuid}:${material.uuid}`;
    let batch = collection.get(key);
    if (!batch) { batch = { geometry, material, matrices: [] }; collection.set(key, batch); }
    return batch;
  };
  const localMatrix = (position: Triple, scale: Triple, rotation: Triple = [0, 0, 0]) => {
    local.position.set(...position); local.scale.set(...scale); local.rotation.set(...rotation); local.updateMatrix();
    return local.matrix.clone();
  };
  const add = (material: THREE.Material, geometry: THREE.BufferGeometry, parent: THREE.Matrix4, position: Triple, scale: Triple, rotation: Triple = [0, 0, 0]) => {
    const batch = getBatch(staticBatches, geometry, material);
    batch.matrices.push(parent.clone().multiply(localMatrix(position, scale, rotation)));
  };
  const identity = new THREE.Matrix4();
  const obstacle = (x: number, z: number, radius: number, bottom: number, top: number) => {
    obstacles.push({ x, z, radius, base: bottom, height: top - groundHeightAt(x, z) });
  };
  const lamps: THREE.PointLight[] = [];

  CABINS.forEach((house, houseIndex) => {
    root.position.set(house.x, house.baseY, house.z); root.rotation.set(0, house.yaw, 0); root.scale.setScalar(1); root.updateMatrix();
    const matrix = root.matrix.clone();
    const w = house.width; const d = house.depth; const h = house.wallHeight;
    add(masonry, roundedBox, matrix, [0, -0.22, 0], [w + 0.32, 0.44, d + 0.32]);
    add(wall, boxGeometry, matrix, [0, h / 2, 0], [w, h, d]);
    add(wall, gableGeometry, matrix, [0, h, -d / 2 - 0.025], [w, house.roofHeight, 0.10]);
    add(wall, gableGeometry, matrix, [0, h, d / 2 - 0.075], [w, house.roofHeight, 0.10]);
    const roofAngle = Math.atan2(house.roofHeight, w / 2);
    const roofLength = Math.hypot(w / 2, house.roofHeight) + 0.50;
    for (const side of [-1, 1]) {
      add(roof, boxGeometry, matrix, [side * w / 4, h + house.roofHeight / 2, 0], [roofLength, 0.16, d + 0.95], [0, 0, -side * roofAngle]);
      add(roofEdge, boxGeometry, matrix, [side * (w / 2 + 0.36), h - 0.1, 0], [0.15, 0.22, d + 0.98]);
      for (let row = 0; row < 5; row++) {
        const px = side * (0.25 + row * w / 10);
        const py = h + house.roofHeight - Math.abs(px) * Math.tan(roofAngle) + 0.10;
        add(roofEdge, boxGeometry, matrix, [px, py, 0], [0.043, 0.043, d + 0.85], [0, 0, -side * roofAngle]);
      }
    }
    add(roofEdge, cylinder, matrix, [0, h + house.roofHeight + 0.05, 0], [0.10, d + 0.96, 0.10], [Math.PI / 2, 0, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(wood, boxGeometry, matrix, [sx * (w / 2 - 0.075), h / 2, sz * (d / 2 + 0.035)], [0.15, h + 0.12, 0.16]);
    for (const y of [0.32, h - 0.15]) {
      add(wood, boxGeometry, matrix, [0, y, d / 2 + 0.075], [w, 0.14, 0.16]);
      add(wood, boxGeometry, matrix, [0, y, -d / 2 - 0.075], [w, 0.14, 0.16]);
    }
    add(wood, boxGeometry, matrix, [0, h + house.roofHeight * 0.35, d / 2 + 0.11], [0.15, house.roofHeight * 0.65, 0.11]);
    add(wood, boxGeometry, matrix, [0, 1.05, d / 2 + 0.10], [1.12, 2.10, 0.18]);
    add(dark, roundedBox, matrix, [0.35, 1.1, d / 2 + 0.215], [0.07, 0.07, 0.04]);
    for (const px of [-w * 0.29, w * 0.29]) {
      add(wood, boxGeometry, matrix, [px, 1.8, d / 2 + 0.13], [1.47, 1.40, 0.14]);
      add(windows, boxGeometry, matrix, [px, 1.8, d / 2 + 0.215], [1.19, 1.13, 0.025]);
      add(woodLight, boxGeometry, matrix, [px, 1.8, d / 2 + 0.24], [0.065, 1.15, 0.04]);
      add(woodLight, boxGeometry, matrix, [px, 1.8, d / 2 + 0.24], [1.21, 0.065, 0.04]);
      for (const side of [-1, 1]) add(roofEdge, boxGeometry, matrix, [px + side * 0.83, 1.8, d / 2 + 0.18], [0.23, 1.22, 0.11]);
    }
    for (const side of [-1, 1]) {
      add(wood, boxGeometry, matrix, [side * (w / 2 + 0.07), 1.7, -0.25], [0.13, 1.30, 1.44]);
      add(windows, boxGeometry, matrix, [side * (w / 2 + 0.15), 1.7, -0.25], [0.025, 1.03, 1.18]);
      add(woodLight, boxGeometry, matrix, [side * (w / 2 + 0.17), 1.7, -0.25], [0.05, 1.05, 0.065]);
      add(woodLight, boxGeometry, matrix, [side * (w / 2 + 0.17), 1.7, -0.25], [0.05, 0.065, 1.20]);
    }
    for (let step = 0; step < 3; step++) add(masonry, boxGeometry, matrix, [0, -0.04 - step * 0.10, d / 2 + 0.43 + step * 0.32], [1.9, 0.20, 0.75]);
    const chimneyX = w * 0.27;
    add(masonry, roundedBox, matrix, [chimneyX, h + house.roofHeight + 0.05, -d * 0.22], [0.65, 1.65, 0.67]);
    add(roofEdge, boxGeometry, matrix, [chimneyX, h + house.roofHeight + 0.92, -d * 0.22], [0.82, 0.17, 0.84]);
    const lamp = new THREE.PointLight('#ffd18c', 0, 14, 2);
    lamp.position.copy(new THREE.Vector3(0, 1.4, d / 2 + 0.9).applyMatrix4(matrix));
    group.add(lamp); lamps.push(lamp);
    obstacles.push({ x: house.x, z: house.z, radius: Math.hypot(w, d) / 2 + 0.1, height: house.baseY + h + house.roofHeight + 0.18 - groundHeightAt(house.x, house.z), roof: true });
    // A woodpile and bench make the three cabins feel inhabited.
    add(woodLight, boxGeometry, matrix, [w / 2 + 1.1, 0.45, houseIndex * 0.45 - 0.8], [0.78, 0.15, 2.15]);
    for (const z of [-0.55, 0.55]) add(wood, boxGeometry, matrix, [w / 2 + 1.1, 0.2, z + houseIndex * 0.45 - 0.8], [0.14, 0.42, 0.15]);
    for (let log = 0; log < 5; log++) add(wood, cylinder, matrix, [-w / 2 - 0.75, 0.17 + Math.floor(log / 3) * 0.27, -1.1 + (log % 3) * 0.3], [0.135, 1.4, 0.135], [Math.PI / 2, 0, 0]);
  });

  BRIDGES.forEach(bridge => {
    root.position.set(bridge.x, 0, bridge.z); root.rotation.set(0, bridge.yaw, 0); root.scale.setScalar(1); root.updateMatrix();
    const matrix = root.matrix.clone();
    const plankStep = 0.72;
    for (let x = -bridge.length / 2 + plankStep / 2; x < bridge.length / 2; x += plankStep) {
      const y = bridgeDeckY(bridge, x);
      const pitch = Math.atan2(bridgeDeckY(bridge, x + 0.2) - bridgeDeckY(bridge, x - 0.2), 0.4);
      add(woodLight, boxGeometry, matrix, [x, y - 0.09, 0], [0.685, 0.18, bridge.width], [0, 0, pitch]);
    }
    for (const z of [-bridge.width * 0.39, 0, bridge.width * 0.39]) add(wood, boxGeometry, matrix, [0, bridge.deckY - 0.37, z], [bridge.span, 0.37, 0.28]);
    for (let x = -bridge.length / 2; x <= bridge.length / 2; x += 3.3) {
      const y = bridgeDeckY(bridge, x);
      for (const side of [-1, 1]) {
        const z = side * (bridge.width / 2 - 0.12);
        add(wood, roundedBox, matrix, [x, y + 0.60, z], [0.15, 1.25, 0.15]);
        const point = bridgePoint(bridge, x, z);
        obstacle(point.x, point.z, 0.16, y, y + 1.25);
        if (x + 3.3 <= bridge.length / 2) {
          const endY = bridgeDeckY(bridge, x + 3.3);
          const pitch = Math.atan2(endY - y, 3.3);
          add(woodLight, roundedBox, matrix, [x + 1.65, (y + endY) / 2 + 1.16, z], [Math.hypot(3.3, endY - y), 0.16, 0.17], [0, 0, pitch]);
          add(wood, boxGeometry, matrix, [x + 1.65, (y + endY) / 2 + 0.51, z], [Math.hypot(3.3, endY - y), 0.09, 0.11], [0, 0, pitch]);
        }
      }
    }
    for (const x of [-bridge.span / 2 + 1, -bridge.span * 0.33, bridge.span * 0.33, bridge.span / 2 - 1]) {
      for (const side of [-1, 1]) {
        const z = side * bridge.width * 0.37;
        const point = bridgePoint(bridge, x, z);
        const base = groundHeightAt(point.x, point.z) - 0.15;
        const top = bridge.deckY - 0.23;
        add(wood, cylinder, matrix, [x, (base + top) / 2, z], [0.28, top - base, 0.28]);
        obstacle(point.x, point.z, 0.30, base, top);
      }
    }
    for (let x = -bridge.length / 2; x <= bridge.length / 2; x += 2.8) {
      const point = bridgePoint(bridge, x);
      const y = bridgeDeckY(bridge, x);
      obstacle(point.x, point.z, 2.3, y - 0.4, y + 0.1);
    }
  });

  PASTURES.forEach(pasture => {
    const radius = pasture.radius + 0.9;
    const posts = 28;
    for (let i = 0; i < posts; i++) {
      // The front gap gives the drone and livestock a clear entrance.
      if (i === 6 || i === 7) continue;
      const angle = i / posts * Math.PI * 2;
      const next = (i + 1) / posts * Math.PI * 2;
      const x = pasture.x + Math.cos(angle) * radius;
      const z = pasture.z + Math.sin(angle) * radius;
      const y = groundHeightAt(x, z);
      add(wood, cylinder, identity, [x, y + 0.58, z], [0.075, 1.16, 0.075]);
      if (i === 5 || i === 6 || i === 7) continue;
      const bx = pasture.x + Math.cos(next) * radius;
      const bz = pasture.z + Math.sin(next) * radius;
      const length = Math.hypot(bx - x, bz - z);
      for (const railY of [0.50, 0.92]) add(woodLight, boxGeometry, identity, [(x + bx) / 2, (y + groundHeightAt(bx, bz)) / 2 + railY, (z + bz) / 2], [0.08, 0.1, length], [0, Math.atan2(bx - x, bz - z), 0]);
    }
  });

  for (const batch of staticBatches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
    batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    batch.mesh = mesh; group.add(mesh);
  }
  const livestock = createLivestock(runtime, world);
  const fish = createFish(runtime);
  group.add(livestock.group, fish.group);
  let disposed = false;
  return {
    group,
    obstacles,
    update(time: number) {
      if (disposed) return;
      livestock.update(time);
      fish.update(time);
    },
    setNight(night: boolean) {
      windows.color.set(night ? '#ebc58b' : '#78908d');
      windows.emissiveIntensity = night ? 1.7 : 0.025;
      lamps.forEach(lamp => { lamp.intensity = night ? 6.5 : 0; });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      livestock.dispose(); fish.dispose();
      group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear(); group.removeFromParent();
      staticBatches.clear();
    },
  };
}
