import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { groundHeight, WATER_LEVEL } from './landscape.ts';
import { BRIDGES, CABINS, FISH_SCHOOLS, PASTURES, bridgeDeckY, bridgePoint } from './rural-layout.ts';

type Triple = [number, number, number];
interface RuralObstacle { x: number; z: number; radius: number; height: number; base?: number; roof?: boolean }
interface Batch { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; mesh?: THREE.InstancedMesh }
interface Animal {
  x: number; z: number; radius: number; phase: number; offset: number; graze: number; species: 'cow' | 'sheep';
}
interface AnimalPart { animal: Animal; pivot: 'body' | 'head' | 'tail' | 'leg'; leg?: number; matrix: THREE.Matrix4; batch: Batch; slot: number }
interface FishPart { school: number; fish: number; kind: 'body' | 'tail'; matrix: THREE.Matrix4; batch: Batch; slot: number }

/** Native rural geometry, batched livestock and fish; local surfaces live in rural-layout. */
export function createRural() {
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
  const cream = matte('#e9e4d3');
  const cowBlack = matte('#28322c');
  const nose = matte('#b88a7c');
  const wool = matte('#e1dfce');
  const sheepFace = matte('#857e6b');
  const horn = matte('#c6baa0');
  const windows = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#78908d', emissive: '#ffd492', emissiveIntensity: 0.025, metalness: 0.16, roughness: 0.25,
  }));
  const fishSilver = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#c4cbb6', emissive: '#797f60', emissiveIntensity: 0.13, metalness: 0.25, roughness: 0.38,
  }));
  const fishGold = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#c79858', emissive: '#a16f35', emissiveIntensity: 0.17, metalness: 0.2, roughness: 0.43,
  }));
  const fishFins = matte('#858862', 0.52);
  const fishEyes = matte('#142e29', 0.24);

  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const roundedBox = ownGeometry(new RoundedBoxGeometry(1, 1, 1, 2, 0.13));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 10));
  const sphere = ownGeometry(new THREE.SphereGeometry(1, 12, 8));
  const tuft = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const cone = ownGeometry(new THREE.ConeGeometry(1, 1, 8));
  const animalBody = ownGeometry(new THREE.CapsuleGeometry(1, 1.1, 4, 12));
  animalBody.rotateX(Math.PI / 2);
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-0.5, 0); gableShape.lineTo(0.5, 0); gableShape.lineTo(0, 1); gableShape.closePath();
  const gableGeometry = ownGeometry(new THREE.ExtrudeGeometry(gableShape, { depth: 1, bevelEnabled: false }));
  const fishProfile = [new THREE.Vector2(0, -0.39), new THREE.Vector2(0.045, -0.32), new THREE.Vector2(0.10, -0.17), new THREE.Vector2(0.115, 0.02), new THREE.Vector2(0.077, 0.24), new THREE.Vector2(0.025, 0.36), new THREE.Vector2(0, 0.39)];
  const fishBody = ownGeometry(new THREE.LatheGeometry(fishProfile, 12));
  fishBody.rotateX(-Math.PI / 2);
  const finGeometry = ownGeometry(new THREE.BufferGeometry());
  finGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0, 0.17, 0.29, 0, 0.055, 0.22,
    0, 0, 0, 0, 0.055, 0.22, 0, -0.055, 0.22,
    0, 0, 0, 0, -0.055, 0.22, 0, -0.17, 0.29,
  ], 3));
  finGeometry.computeVertexNormals();
  fishFins.side = THREE.DoubleSide;

  const staticBatches = new Map<string, Batch>();
  const dynamicBatches = new Map<string, Batch>();
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
    obstacles.push({ x, z, radius, base: bottom, height: top - groundHeight(x, z) });
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
    obstacles.push({ x: house.x, z: house.z, radius: Math.hypot(w, d) / 2 + 0.1, height: house.baseY + h + house.roofHeight + 0.18 - groundHeight(house.x, house.z), roof: true });
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
        const base = groundHeight(point.x, point.z) - 0.15;
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
      const y = groundHeight(x, z);
      add(wood, cylinder, identity, [x, y + 0.58, z], [0.075, 1.16, 0.075]);
      if (i === 5 || i === 6 || i === 7) continue;
      const bx = pasture.x + Math.cos(next) * radius;
      const bz = pasture.z + Math.sin(next) * radius;
      const length = Math.hypot(bx - x, bz - z);
      for (const railY of [0.50, 0.92]) add(woodLight, boxGeometry, identity, [(x + bx) / 2, (y + groundHeight(bx, bz)) / 2 + railY, (z + bz) / 2], [0.08, 0.1, length], [0, Math.atan2(bx - x, bz - z), 0]);
    }
  });

  const animals: Animal[] = [];
  const animalParts: AnimalPart[] = [];
  const addAnimalPart = (animal: Animal, pivot: AnimalPart['pivot'], material: THREE.Material, geometry: THREE.BufferGeometry, position: Triple, scale: Triple, rotation: Triple = [0, 0, 0], leg?: number) => {
    const batch = getBatch(dynamicBatches, geometry, material);
    const slot = batch.matrices.length;
    const matrix = localMatrix(position, scale, rotation);
    batch.matrices.push(new THREE.Matrix4());
    animalParts.push({ animal, pivot, leg, matrix, batch, slot });
  };
  PASTURES.forEach(pasture => {
    for (let i = 0; i < pasture.count; i++) {
      const animal: Animal = { x: pasture.x, z: pasture.z, radius: 4.5 + (i % 4) * 1.6, phase: i * 2.41 + (pasture.species === 'cow' ? 0 : 0.8), offset: i * 1.7, graze: 0, species: pasture.species };
      animals.push(animal);
      const cow = pasture.species === 'cow';
      addAnimalPart(animal, 'body', cow ? cream : wool, animalBody, [0, cow ? 1.08 : 0.79, 0], cow ? [0.49, 0.43, 0.66] : [0.33, 0.32, 0.48]);
      if (cow) {
        for (const side of [-1, 1]) for (let patch = 0; patch < 3; patch++) addAnimalPart(animal, 'body', cowBlack, sphere, [side * 0.46, 1.08 + (patch % 2) * 0.13, -0.5 + patch * 0.47], [0.045, 0.23 + patch * 0.025, 0.30 - patch * 0.04], [0.2 * patch, 0, side * 0.15]);
        addAnimalPart(animal, 'body', nose, sphere, [0, 0.66, 0.30], [0.19, 0.12, 0.25]);
      } else {
        for (let puff = 0; puff < 11; puff++) {
          const side = puff % 3 - 1;
          addAnimalPart(animal, 'body', wool, tuft, [side * 0.26, 0.91 + (puff % 2) * 0.09, -0.51 + Math.floor(puff / 3) * 0.31], [0.23, 0.23, 0.26]);
        }
      }
      addAnimalPart(animal, 'head', cow ? cowBlack : sheepFace, roundedBox, [0, 0, -0.25], cow ? [0.39, 0.38, 0.46] : [0.23, 0.23, 0.36]);
      addAnimalPart(animal, 'head', cow ? nose : sheepFace, roundedBox, [0, -0.09, cow ? -0.51 : -0.43], cow ? [0.37, 0.20, 0.18] : [0.20, 0.16, 0.14]);
      for (const side of [-1, 1]) {
        addAnimalPart(animal, 'head', cow ? cream : sheepFace, sphere, [side * (cow ? 0.29 : 0.20), 0.12, -0.20], cow ? [0.16, 0.052, 0.087] : [0.13, 0.047, 0.06], [0, side * 0.15, side * 0.24]);
        addAnimalPart(animal, 'head', dark, sphere, [side * (cow ? 0.20 : 0.12), 0.095, cow ? -0.38 : -0.34], [0.027, 0.027, 0.034]);
        if (cow) addAnimalPart(animal, 'head', horn, cone, [side * 0.14, 0.30, -0.23], [0.045, 0.24, 0.045], [0, 0, -side * 0.40]);
      }
      for (let leg = 0; leg < 4; leg++) {
        addAnimalPart(animal, 'leg', cow ? cream : sheepFace, cylinder, [0, cow ? -0.39 : -0.25, 0], cow ? [0.08, 0.78, 0.08] : [0.05, 0.5, 0.05], [0, 0, 0], leg);
        addAnimalPart(animal, 'leg', dark, roundedBox, [0, cow ? -0.80 : -0.52, -0.015], cow ? [0.16, 0.13, 0.18] : [0.11, 0.095, 0.12], [0, 0, 0], leg);
      }
      addAnimalPart(animal, 'tail', cow ? cream : wool, cylinder, [0, -0.18, 0.025], cow ? [0.031, 0.38, 0.031] : [0.07, 0.20, 0.07], [0.16, 0, 0]);
      if (cow) addAnimalPart(animal, 'tail', cowBlack, sphere, [0, -0.39, 0.07], [0.055, 0.10, 0.055]);
    }
  });

  const fishParts: FishPart[] = [];
  const addFishPart = (school: number, fish: number, kind: FishPart['kind'], material: THREE.Material, geometry: THREE.BufferGeometry, position: Triple, scale: Triple, rotation: Triple = [0, 0, 0]) => {
    const batch = getBatch(dynamicBatches, geometry, material);
    const slot = batch.matrices.length;
    batch.matrices.push(new THREE.Matrix4());
    fishParts.push({ school, fish, kind, matrix: localMatrix(position, scale, rotation), batch, slot });
  };
  FISH_SCHOOLS.forEach((school, schoolIndex) => {
    for (let fish = 0; fish < school.count; fish++) {
      const material = fish % 3 === 0 ? fishGold : fishSilver;
      const size = 0.86 + (fish % 5) * 0.11;
      addFishPart(schoolIndex, fish, 'body', material, fishBody, [0, 0, 0], [size, size * 0.7, size]);
      addFishPart(schoolIndex, fish, 'tail', fishFins, finGeometry, [0, 0, 0], [size, size * 0.72, size]);
      addFishPart(schoolIndex, fish, 'body', fishFins, finGeometry, [0, 0.04, -0.05], [size * 0.4, size * 0.40, -size * 0.5], [0, 0, 0]);
      for (const side of [-1, 1]) {
        addFishPart(schoolIndex, fish, 'body', fishFins, finGeometry, [side * 0.06, -0.04, 0], [size * 0.38, size * 0.42, size * 0.33], [0, side * 0.75, side * Math.PI / 2]);
        addFishPart(schoolIndex, fish, 'body', fishEyes, sphere, [side * 0.055, 0.02, -0.285], [0.017, 0.017, 0.017]);
      }
    }
  });

  for (const collection of [staticBatches, dynamicBatches]) {
    for (const batch of collection.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.castShadow = collection === staticBatches;
      mesh.receiveShadow = true;
      if (collection === dynamicBatches) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
      }
      batch.mesh = mesh; group.add(mesh);
    }
  }

  const animalRoots = new Map<Animal, THREE.Matrix4>();
  const animalPivots = new Map<Animal, { head: THREE.Matrix4; tail: THREE.Matrix4; legs: THREE.Matrix4[] }>();
  const fishRoots: THREE.Matrix4[][] = FISH_SCHOOLS.map(school => Array.from({ length: school.count }, () => new THREE.Matrix4()));
  const fishTailRoots: THREE.Matrix4[][] = FISH_SCHOOLS.map(school => Array.from({ length: school.count }, () => new THREE.Matrix4()));
  let lastTime: number | undefined;
  let disposed = false;

  const update = (time: number) => {
    if (disposed) return;
    const dt = lastTime === undefined ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, 0.08);
    lastTime = time;
    animals.forEach(animal => {
      const eating = Math.sin(time * 0.27 + animal.offset) > -0.18;
      animal.graze += ((eating ? 1 : 0) - animal.graze) * Math.min(1, dt * 3);
      if (!eating) animal.phase += dt * (animal.species === 'cow' ? 0.065 : 0.083);
      const phase = animal.phase;
      const x = animal.x + Math.cos(phase) * animal.radius;
      const z = animal.z + Math.sin(phase) * animal.radius * 0.77;
      const heading = Math.atan2(Math.sin(phase), -Math.cos(phase) * 0.77);
      root.position.set(x, groundHeight(x, z), z); root.rotation.set(0, heading, 0); root.scale.setScalar(1); root.updateMatrix();
      const base = animalRoots.get(animal) ?? new THREE.Matrix4(); base.copy(root.matrix); animalRoots.set(animal, base);
      const cow = animal.species === 'cow';
      const pivots = animalPivots.get(animal) ?? { head: new THREE.Matrix4(), tail: new THREE.Matrix4(), legs: Array.from({ length: 4 }, () => new THREE.Matrix4()) };
      pivots.head.copy(base).multiply(localMatrix([0, cow ? 1.15 : 0.86, cow ? -0.74 : -0.56], [1, 1, 1], [-animal.graze * 1.07 + Math.sin(time * 2.1 + animal.offset) * 0.035 * animal.graze, 0, 0]));
      pivots.tail.copy(base).multiply(localMatrix([0, cow ? 1.2 : 0.98, cow ? 0.96 : 0.72], [1, 1, 1], [0, 0, Math.sin(time * 1.4 + animal.offset) * 0.24]));
      for (let leg = 0; leg < 4; leg++) {
        const side = leg % 2 === 0 ? -1 : 1;
        const front = leg < 2;
        const stride = eating ? 0 : Math.sin(time * 4.4 + animal.offset + (leg === 0 || leg === 3 ? 0 : Math.PI)) * 0.23;
        pivots.legs[leg].copy(base).multiply(localMatrix([side * (cow ? 0.30 : 0.21), cow ? 0.91 : 0.62, (front ? -1 : 1) * (cow ? 0.61 : 0.42)], [1, 1, 1], [stride, 0, 0]));
      }
      animalPivots.set(animal, pivots);
    });
    for (const part of animalParts) {
      const pivots = animalPivots.get(part.animal)!;
      const parent = part.pivot === 'body' ? animalRoots.get(part.animal)! : part.pivot === 'leg' ? pivots.legs[part.leg!] : pivots[part.pivot];
      part.batch.mesh!.setMatrixAt(part.slot, local.matrix.multiplyMatrices(parent, part.matrix));
    }

    FISH_SCHOOLS.forEach((school, schoolIndex) => {
      for (let fish = 0; fish < school.count; fish++) {
        const progress = ((time * 0.012 + fish * 0.081 + schoolIndex * 0.17) % 1 + 1) % 1;
        const sample = progress * school.points.length;
        const index = Math.floor(sample);
        const a = school.points[index];
        const b = school.points[(index + 1) % school.points.length];
        const fraction = sample - index;
        const offsetX = Math.sin(fish * 2.41) * school.spread;
        const offsetZ = Math.cos(fish * 1.93) * school.spread;
        const x = a.x + (b.x - a.x) * fraction + offsetX;
        const z = a.z + (b.z - a.z) * fraction + offsetZ;
        root.position.set(x, WATER_LEVEL - 0.25 - (fish % 3) * 0.065 + Math.sin(time * 0.9 + fish) * 0.025, z);
        root.rotation.set(0, Math.atan2(-(b.x - a.x), -(b.z - a.z)), Math.sin(time * 1.3 + fish) * 0.05);
        root.scale.setScalar(1); root.updateMatrix();
        fishRoots[schoolIndex][fish].copy(root.matrix);
        fishTailRoots[schoolIndex][fish].copy(root.matrix).multiply(localMatrix([0, 0, 0.29], [1, 1, 1], [0, Math.sin(time * 6.3 + fish * 0.9) * 0.46, 0]));
      }
    });
    for (const part of fishParts) {
      const parent = part.kind === 'tail' ? fishTailRoots[part.school][part.fish] : fishRoots[part.school][part.fish];
      part.batch.mesh!.setMatrixAt(part.slot, local.matrix.multiplyMatrices(parent, part.matrix));
    }
    for (const batch of dynamicBatches.values()) batch.mesh!.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return {
    group,
    obstacles,
    update,
    setNight(night: boolean) {
      windows.color.set(night ? '#ebc58b' : '#78908d');
      windows.emissiveIntensity = night ? 1.7 : 0.025;
      lamps.forEach(lamp => { lamp.intensity = night ? 6.5 : 0; });
      fishSilver.emissiveIntensity = night ? 0.24 : 0.13;
      fishGold.emissiveIntensity = night ? 0.28 : 0.17;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear(); group.removeFromParent();
      staticBatches.clear(); dynamicBatches.clear(); animalRoots.clear(); animalPivots.clear();
    },
  };
}
