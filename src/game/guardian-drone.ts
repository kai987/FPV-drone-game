import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getDroneSpec } from './drone-catalog.ts';

/** Fictional game art, in scene units. The barrel and aiming pivot point along local -Z. */
export function createGuardianDrone() {
  const spec = getDroneSpec('guardian');
  const model = new THREE.Group();
  model.name = `AEROFLOW ${spec.name}`;
  model.userData.droneId = spec.id;
  model.userData.frame = spec.frame;
  model.userData.weapon = spec.weapon;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const ownGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const material = (color: string, roughness: number, metalness = 0) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness, metalness }); materials.add(value); return value;
  };
  const olive = material(spec.color, 0.57, 0.16);
  const darkOlive = material('#424c34', 0.66, 0.12);
  const bronze = material('#957349', 0.42, 0.65);
  const graphite = material('#20272b', 0.53, 0.3);
  const rubber = material('#151b1d', 0.82);
  const steel = material('#8a989b', 0.3, 0.82);
  const glass = material('#153443', 0.12, 0.68);
  const redLight = material('#b15339', 0.45); redLight.emissive.set('#ed4a2e'); redLight.emissiveIntensity = 0.7;
  const greenLight = material('#719d71', 0.45); greenLight.emissive.set('#9bd897'); greenLight.emissiveIntensity = 0.8;
  const propMaterial = material('#343d32', 0.45, 0.12); propMaterial.name = 'FPV propeller polymer';
  propMaterial.side = THREE.DoubleSide;
  const blurMaterial = new THREE.MeshBasicMaterial({ color: '#afad84', side: THREE.DoubleSide, transparent: true, opacity: 0.07, depthWrite: false, toneMapped: false });
  materials.add(blurMaterial);
  const cube = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const rounded = ownGeometry(new RoundedBoxGeometry(1, 1, 1, 2, 0.11));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 12));
  const sphere = ownGeometry(new THREE.SphereGeometry(1, 12, 8));
  const group = (name: string, parent: THREE.Object3D = model) => {
    const value = new THREE.Group(); value.name = name; parent.add(value); return value;
  };
  const mesh = (geometry: THREE.BufferGeometry, finish: THREE.Material, parent: THREE.Object3D, name = '') => {
    const value = new THREE.Mesh(geometry, finish); value.name = name;
    value.castShadow = value.receiveShadow = true; parent.add(value); return value;
  };
  type Point = [number, number, number];
  const box = (parent: THREE.Object3D, finish: THREE.Material, position: Point, size: Point, soft = false, name = '') => {
    const value = mesh(soft ? rounded : cube, finish, parent, name); value.position.set(...position); value.scale.set(...size); return value;
  };
  const post = (parent: THREE.Object3D, finish: THREE.Material, position: Point, radius: number, length: number, name = '') => {
    const value = mesh(cylinder, finish, parent, name); value.position.set(...position); value.scale.set(radius, length, radius); return value;
  };
  const strut = (parent: THREE.Object3D, finish: THREE.Material, start: Point, end: Point, radius: number, name = '') => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const value = post(parent, finish, [0, 0, 0], radius, a.distanceTo(b), name);
    value.position.copy(a).add(b).multiplyScalar(0.5);
    value.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize()); return value;
  };
  const frame = group('GUARDIAN eight-arm frame');
  const shell = group('GUARDIAN olive body and navigation gear');
  const landingGear = group('GUARDIAN tall landing skids');
  box(shell, graphite, [0, 0.04, 0.06], [0.83, 0.24, 1.18], true, 'GUARDIAN lower equipment bay');
  box(shell, olive, [0, 0.23, 0.03], [0.91, 0.21, 1.31], true, 'GUARDIAN olive top fairing');
  box(shell, darkOlive, [0, 0.347, 0.09], [0.61, 0.05, 0.85], true);
  for (const side of [-1, 1]) {
    box(shell, graphite, [side * 0.253, 0.392, 0.13], [0.198, 0.135, 0.59], true, 'GUARDIAN dual battery enclosure');
    for (const z of [-0.035, 0.305]) box(shell, bronze, [side * 0.253, 0.463, z], [0.214, 0.017, 0.048]);
    for (let slot = 0; slot < 5; slot++) box(shell, graphite, [side * 0.456, 0.22, -0.25 + slot * 0.117], [0.009, 0.055, 0.051]);
    box(shell, bronze, [side * 0.24, 0.29, -0.48], [0.17, 0.025, 0.22], true);
    post(shell, graphite, [side * 0.26, 0.49, 0.51], 0.015, 0.38);
    post(shell, olive, [side * 0.26, 0.685, 0.51], 0.038, 0.032);
    box(shell, side < 0 ? redLight : greenLight, [side * 0.40, 0.12, -0.55], [0.045, 0.035, 0.04]);
    // Broad skids leave clearance below the visual gimbal.
    strut(landingGear, bronze, [side * 0.34, -0.06, -0.38], [side * 0.64, -0.87, -0.49], 0.035);
    strut(landingGear, bronze, [side * 0.34, -0.06, 0.43], [side * 0.64, -0.87, 0.49], 0.035);
    strut(landingGear, graphite, [side * 0.64, -0.87, -0.79], [side * 0.64, -0.87, 0.86], 0.043, 'GUARDIAN landing rail');
    strut(landingGear, graphite, [side * 0.64, -0.87, -0.79], [side * 0.64, -0.74, -0.96], 0.043);
    for (const z of [-0.55, 0.62]) box(landingGear, rubber, [side * 0.64, -0.902, z], [0.12, 0.048, 0.2], true);
  }
  const camera = group('Tilted FPV camera'); camera.position.set(0, 0.125, -0.67); camera.rotation.x = 0.24;
  box(camera, graphite, [0, 0, 0], [0.28, 0.16, 0.16], true);
  post(camera, bronze, [0, 0, -0.095], 0.09, 0.08).rotation.x = Math.PI / 2;
  post(camera, glass, [0, 0, -0.138], 0.071, 0.011).rotation.x = Math.PI / 2;

  // A readable game silhouette only: housing, single barrel and optical sensor.
  const mount = group('GUARDIAN underslung gimbal mount');
  // Suspend the payload visibly below the fuselage while its housing clears the skids.
  post(mount, bronze, [0, -0.32, -0.29], 0.17, 0.46);
  for (const side of [-1, 1]) box(mount, graphite, [side * 0.20, -0.64, -0.29], [0.065, 0.34, 0.19], true);
  const pivot = group('gun-pivot'); pivot.position.set(0, -0.78, -0.29);
  const payload = group('GUARDIAN game machine gun', pivot);
  box(payload, darkOlive, [0, 0, 0.025], [0.31, 0.235, 0.47], true);
  box(payload, bronze, [-0.22, -0.025, 0.035], [0.14, 0.19, 0.25], true);
  post(payload, graphite, [0, 0.012, -0.415], 0.058, 0.43).rotation.x = Math.PI / 2;
  post(payload, steel, [0, 0.012, -0.67], 0.032, 0.19).rotation.x = Math.PI / 2;
  post(payload, graphite, [0, 0.012, -0.78], 0.052, 0.08).rotation.x = Math.PI / 2;
  post(payload, rubber, [0, 0.012, -0.822], 0.03, 0.005).rotation.x = Math.PI / 2;
  const sensor = mesh(sphere, graphite, payload); sensor.position.set(0.11, 0.162, -0.14); sensor.scale.set(0.09, 0.075, 0.08);
  post(payload, glass, [0.11, 0.162, -0.216], 0.05, 0.008).rotation.x = Math.PI / 2;
  const muzzle = new THREE.Object3D(); muzzle.name = 'gun-muzzle'; muzzle.position.set(0, 0.012, -0.827); pivot.add(muzzle);

  // Thin swept blades use the same semantic material and rotor groups as other aircraft.
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.05, -0.035); bladeShape.quadraticCurveTo(0.25, -0.115, 0.48, -0.09);
  bladeShape.quadraticCurveTo(0.51, -0.075, 0.48, -0.045); bladeShape.quadraticCurveTo(0.26, 0.043, 0.05, 0.035); bladeShape.closePath();
  const bladeGeometry = ownGeometry(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.009, bevelEnabled: false, curveSegments: 5, steps: 1 }));
  bladeGeometry.rotateX(-Math.PI / 2);
  const discGeometry = ownGeometry(new THREE.CircleGeometry(0.51, 32)); discGeometry.rotateX(-Math.PI / 2);
  const rotors: THREE.Group[] = [];
  const blurs: THREE.Mesh[] = [];
  for (let index = 0; index < 8; index++) {
    const angle = (index + 0.5) * Math.PI / 4;
    const x = Math.sin(angle) * 1.57, z = Math.cos(angle) * 1.57;
    const arm = box(frame, graphite, [x * 0.57, 0.074, z * 0.57], [0.102, 0.085, 1.40], true, 'GUARDIAN extended motor arm');
    arm.rotation.y = angle;
    const clamp = box(frame, bronze, [x * 0.71, 0.084, z * 0.71], [0.145, 0.12, 0.12], true); clamp.rotation.y = angle;
    strut(frame, darkOlive, [x * 0.25, 0.13, z * 0.25], [x * 0.95, 0.13, z * 0.95], 0.014);
    post(frame, bronze, [x, 0.104, z], 0.13, 0.065);
    post(frame, graphite, [x, 0.182, z], 0.11, 0.10);
    for (let fin = 0; fin < 3; fin++) post(frame, steel, [x, 0.145 + fin * 0.028, z], 0.114, 0.008);
    const rotor = group('Brushless motor and twisted propeller'); rotor.position.set(x, 0.251, z);
    for (let blade = 0; blade < 2; blade++) mesh(bladeGeometry, propMaterial, rotor).rotation.y = blade * Math.PI;
    post(rotor, bronze, [0, 0.009, 0], 0.066, 0.022);
    const blur = mesh(discGeometry, blurMaterial, model); blur.position.set(x, 0.255, z); blur.visible = false; blur.castShadow = blur.receiveShadow = false;
    rotors.push(rotor); blurs.push(blur);
  }

  // Reduce draw calls without merging across the animated gimbal or rotors.
  const batch = (assembly: THREE.Group) => {
    model.updateMatrixWorld(true);
    const inverse = assembly.matrixWorld.clone().invert();
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    assembly.traverse(part => {
      if (!(part instanceof THREE.Mesh) || Array.isArray(part.material)) return;
      const parts = batches.get(part.material) ?? []; parts.push(part); batches.set(part.material, parts);
    });
    for (const [finish, parts] of batches) {
      if (parts.length < 2) continue;
      const temporary = parts.map(part => {
        const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
        geometry.applyMatrix4(inverse.clone().multiply(part.matrixWorld)); return geometry;
      });
      const geometry = mergeGeometries(temporary, false);
      temporary.forEach(value => value.dispose());
      if (!geometry) continue;
      const combined = mesh(ownGeometry(geometry), finish, assembly, `${assembly.name} · ${finish.type}`);
      combined.userData.partNames = parts.map(part => part.name).filter(Boolean);
      parts.forEach(part => part.removeFromParent());
    }
  };
  [frame, shell, landingGear, camera, mount, payload, ...rotors].forEach(batch);
  let previousTime: number | undefined;
  let disposed = false;
  return {
    model,
    update(time: number, flying: boolean, speed: number) {
      if (disposed) return;
      const dt = previousTime === undefined ? 0 : THREE.MathUtils.clamp(time - previousTime, 0, 0.08); previousTime = time;
      const angularSpeed = flying ? 52 + Math.min(100, Math.max(0, speed)) * 0.55 : 0;
      rotors.forEach((rotor, index) => {
        rotor.rotation.y = (rotor.rotation.y + angularSpeed * dt * (index % 2 ? 1 : -1)) % (Math.PI * 2);
        blurs[index].visible = flying;
      });
      greenLight.emissiveIntensity = flying ? 1.2 : 0.8;
      redLight.emissiveIntensity = flying ? 1.0 + Math.sin(time * 3.3) * 0.1 : 0.7;
    },
    dispose() {
      if (disposed) return; disposed = true;
      geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
      model.clear(); model.removeFromParent();
    },
  };
}
