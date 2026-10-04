import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { groundHeight } from './landscape.ts';
import { PASTURES } from './rural-layout.ts';
import type { Pasture } from './rural-layout.ts';
import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';
import { createLivestockSimulation } from './effect-simulation.ts';

type Triple = readonly [number, number, number];
type Section = readonly [z: number, width: number, height: number, centerY: number];
interface Batch {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  parts: Part[];
  mesh?: THREE.InstancedMesh;
  name?: string;
  species?: 'cow' | 'sheep';
}
interface Part { parent: THREE.Matrix4; local: THREE.Matrix4 }
interface Leg {
  front: boolean;
  side: number;
  phase: number;
  points: THREE.Vector3[];
  bones: THREE.Matrix4[];
  joints: THREE.Matrix4[];
  foot: THREE.Matrix4;
}
interface Animal {
  species: 'cow' | 'sheep';
  field: Pasture;
  phase: number;
  radius: number;
  offset: number;
  size: number;
  graze: number;
  walk: number;
  activityOffset: number;
  root: THREE.Matrix4;
  head: THREE.Matrix4;
  neck: THREE.Matrix4;
  tail: THREE.Matrix4;
  legs: Leg[];
}

const TAU = Math.PI * 2;
const smooth = (v: number) => v * v * (3 - 2 * v);
const hash = (x: number, y: number, z: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
};
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x); const iy = Math.floor(y); const iz = Math.floor(z);
  const tx = smooth(x - ix); const ty = smooth(y - iy); const tz = smooth(z - iz);
  const a = THREE.MathUtils.lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), tx);
  const b = THREE.MathUtils.lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), tx);
  const c = THREE.MathUtils.lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), tx);
  const d = THREE.MathUtils.lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), tx);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ty), THREE.MathUtils.lerp(c, d, ty), tz);
}
function cowColor(x: number, y: number, z: number, color: THREE.Color): void {
  // One spatial field colors the entire skin: irregular patches follow the anatomy,
  // rather than sitting on top of it as separate decals or floating shapes.
  const warp = noise(x * 4.2 + 6, y * 3.4, z * 3.8) - 0.5;
  const patch = noise(x * 2.05 + warp * 0.7 + 9, y * 1.8 + 3, z * 1.85 + warp * 0.6)
    + (noise(x * 7 + 2, y * 6, z * 7) - 0.5) * 0.12;
  const white = smooth(THREE.MathUtils.clamp((patch - 0.46) / 0.045, 0, 1));
  color.setRGB(THREE.MathUtils.lerp(0.018, 0.86, white), THREE.MathUtils.lerp(0.022, 0.835, white), THREE.MathUtils.lerp(0.023, 0.78, white));
}

const COW_BODY: readonly Section[] = [
  [-1.03, 0.15, 0.29, 1.20], [-0.86, 0.31, 0.44, 1.19],
  [-0.64, 0.40, 0.49, 1.24], [-0.39, 0.465, 0.535, 1.145],
  [-0.05, 0.49, 0.52, 1.135], [0.26, 0.475, 0.48, 1.18],
  [0.49, 0.39, 0.42, 1.265], [0.73, 0.365, 0.445, 1.275],
  [0.91, 0.30, 0.405, 1.26], [1.04, 0.14, 0.28, 1.26],
];
const SHEEP_BODY: readonly Section[] = [
  [-0.66, 0.13, 0.20, 0.79], [-0.52, 0.29, 0.325, 0.78],
  [-0.29, 0.375, 0.355, 0.78], [0.04, 0.40, 0.36, 0.78],
  [0.32, 0.36, 0.34, 0.79], [0.54, 0.275, 0.295, 0.79],
  [0.68, 0.105, 0.185, 0.79],
];
function sectionAt(sections: readonly Section[], z: number, out: number[]): void {
  let i = 0;
  while (i < sections.length - 2 && z > sections[i + 1][0]) i++;
  const a = sections[i]; const b = sections[i + 1];
  const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  for (let axis = 1; axis < 4; axis++) {
    const p = sections[Math.max(0, i - 1)][axis];
    const n = sections[Math.min(sections.length - 1, i + 2)][axis];
    const v0 = (b[axis] - p) * 0.5;
    const v1 = (n - a[axis]) * 0.5;
    out[axis - 1] = (2 * a[axis] - 2 * b[axis] + v0 + v1) * t * t * t
      + (-3 * a[axis] + 3 * b[axis] - 2 * v0 - v1) * t * t + v0 * t + a[axis];
  }
}
function loft(sections: readonly Section[], along: number, around: number, paint = false, wool = false, paintOffset: Triple = [0, 0, 0]): THREE.BufferGeometry {
  const positions: number[] = []; const colors: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  const section: number[] = [0, 0, 0]; const color = new THREE.Color();
  const first = sections[0][0]; const last = sections[sections.length - 1][0];
  for (let j = 0; j <= along; j++) {
    const z = THREE.MathUtils.lerp(first, last, j / along);
    sectionAt(sections, z, section);
    for (let i = 0; i <= around; i++) {
      const theta = i / around * TAU;
      const c = Math.cos(theta); const s = Math.sin(theta);
      let x = section[0] * c;
      let y = section[2] + section[1] * Math.sign(s) * Math.pow(Math.abs(s), 0.94);
      if (sections === COW_BODY) {
        // Shape scapulae and the withers into the continuous hide. The lower
        // rib cage is broad, while the flank tightens ahead of the pelvis.
        const shoulder = Math.exp(-Math.pow((z + 0.65) / 0.17, 2));
        x += Math.sign(c) * shoulder * Math.abs(c * s) * 0.045;
        y += shoulder * Math.max(0, s) ** 6 * 0.033;
      }
      if (wool) {
        const fuzz = (noise(x * 29, y * 29, z * 29) - 0.45) * 0.026;
        x += c * fuzz; y += s * fuzz;
      }
      positions.push(x, y, z);
      uvs.push(i / around, j / along);
      if (paint) {
        cowColor(x + paintOffset[0], y + paintOffset[1], z + paintOffset[2], color);
        colors.push(color.r, color.g, color.b);
      }
      if (j < along && i < around) {
        const v = j * (around + 1) + i;
        // The circumference is counter-clockwise when seen from the front.
        indices.push(v, v + 1, v + around + 2, v, v + around + 2, v + around + 1);
      }
    }
  }
  for (const end of [0, along]) {
    const center = positions.length / 3;
    sectionAt(sections, end === 0 ? first : last, section);
    positions.push(0, section[2], end === 0 ? first : last); uvs.push(0.5, end / along);
    if (paint) { cowColor(paintOffset[0], section[2] + paintOffset[1], (end === 0 ? first : last) + paintOffset[2], color); colors.push(color.r, color.g, color.b); }
    for (let i = 0; i < around; i++) {
      const v = end * (around + 1) + i;
      if (end === 0) indices.push(center, v + 1, v);
      else indices.push(center, v, v + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (paint) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  // Match normals across the UV seam so neither side develops a visible stripe.
  const normals = geometry.getAttribute('normal');
  for (let j = 0; j <= along; j++) {
    const a = j * (around + 1); const b = a + around;
    const x = (normals.getX(a) + normals.getX(b)) / 2;
    const y = (normals.getY(a) + normals.getY(b)) / 2;
    const z = (normals.getZ(a) + normals.getZ(b)) / 2;
    const length = Math.hypot(x, y, z);
    normals.setXYZ(a, x / length, y / length, z / length); normals.setXYZ(b, x / length, y / length, z / length);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function earGeometry(): THREE.BufferGeometry {
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const width = Math.pow(Math.sin(Math.PI * t), 0.75) * 0.075 + 0.006 * (1 - t);
    for (let side = -1; side <= 1; side++) {
      positions.push(t * 0.31, -t * 0.065 + Math.sin(Math.PI * t) * (side === 0 ? 0.022 : -0.006), width * side);
      uvs.push(t, (side + 1) / 2);
      if (i < steps && side < 1) {
        const a = i * 3 + side + 1;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
function taperedTube(points: readonly Triple[], radius: number, taper: number, segments = 18, radial = 8): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    curve.getPoint(i / segments, point);
    const r = radius * THREE.MathUtils.lerp(1, taper, i / segments);
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * TAU;
      const n = frames.normals[i]; const b = frames.binormals[i];
      positions.push(point.x + r * (Math.cos(angle) * n.x + Math.sin(angle) * b.x), point.y + r * (Math.cos(angle) * n.y + Math.sin(angle) * b.y), point.z + r * (Math.cos(angle) * n.z + Math.sin(angle) * b.z));
      uvs.push(j / radial, i / segments);
      if (i < segments && j < radial) {
        const a = i * (radial + 1) + j;
        indices.push(a, a + 1, a + radial + 1, a + 1, a + radial + 2, a + radial + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

/** Continuous anatomical skins, fine fleece and jointed, gently moving livestock. */
export function createLivestock(runtime?: RustRuntime, world?: WorldKernel) {
  const group = new THREE.Group(); group.name = 'Grazing cattle and sheep';
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
  const ownGeometry = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
  const ownMaterial = <T extends THREE.Material>(value: T) => { materials.add(value); return value; };
  const grainTexture = (wool: boolean) => {
    const size = 256; const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      // Integer-frequency periodic signals make the bump maps seamlessly tileable.
      const u = x / size * TAU; const v = y / size * TAU;
      const wave = wool ? Math.sin(u * 19 + Math.sin(v * 13) * 2.3) * Math.cos(v * 17 + Math.cos(u * 11) * 1.8) : Math.sin(u * 73 + Math.sin(v * 9)) * Math.cos(v * 29);
      const value = Math.round(128 + wave * (wool ? 71 : 37) + Math.sin(u * 41 + v * 37) * 15);
      const index = (y * size + x) * 4; data[index] = data[index + 1] = data[index + 2] = value; data[index + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, size, size); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
    texture.repeat.set(wool ? 3 : 2, wool ? 4 : 2); textures.add(texture); return texture;
  };
  const coatGrain = grainTexture(false); const fleeceGrain = grainTexture(true);
  const matte = (color: string, roughness = 0.82) => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness }));
  const cowSkin = ownMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.84, bumpMap: coatGrain, bumpScale: 0.0018 }));
  const whiteCoat = ownMaterial(new THREE.MeshStandardMaterial({ color: '#eee9dc', roughness: 0.88, bumpMap: coatGrain, bumpScale: 0.0014 }));
  const blackCoat = ownMaterial(new THREE.MeshStandardMaterial({ color: '#272c29', roughness: 0.84, bumpMap: coatGrain, bumpScale: 0.0014 }));
  const fleece = ownMaterial(new THREE.MeshStandardMaterial({ color: '#ddd6bd', roughness: 0.97, bumpMap: fleeceGrain, bumpScale: 0.008 }));
  const fleeceTips = ownMaterial(new THREE.MeshStandardMaterial({ color: '#e8e0c8', roughness: 0.98, bumpMap: fleeceGrain, bumpScale: 0.003 }));
  const sheepSkin = ownMaterial(new THREE.MeshStandardMaterial({ color: '#534c3e', roughness: 0.91, bumpMap: coatGrain, bumpScale: 0.0014 }));
  const sheepFace = matte('#353b35', 0.9); const hoof = matte('#4c4940', 0.73);
  const nose = matte('#383c39', 0.43); const nostril = matte('#121813', 0.8);
  const eye = matte('#111813', 0.23); const eyeRim = matte('#41443a', 0.74);
  const horn = matte('#cfc6a8', 0.76); const udder = matte('#c1a28d', 0.86);
  const earOuter = ownMaterial(new THREE.MeshStandardMaterial({ color: '#353930', roughness: 0.92, side: THREE.DoubleSide }));
  const earInner = ownMaterial(new THREE.MeshStandardMaterial({ color: '#aa8e7f', roughness: 0.94, side: THREE.DoubleSide }));
  const sheepEarInner = ownMaterial(new THREE.MeshStandardMaterial({ color: '#89745e', roughness: 0.94, side: THREE.DoubleSide }));

  const cowBody = ownGeometry(loft(COW_BODY, 56, 48, true));
  const sheepBody = ownGeometry(loft(SHEEP_BODY, 42, 40, false, true));
  const cowNeck = ownGeometry(loft([[-0.55, 0.18, 0.205, -0.02], [-0.36, 0.22, 0.245, -0.035], [-0.16, 0.265, 0.305, -0.025], [0, 0.315, 0.35, -0.015]], 22, 32, true, false, [0, 1.18, -0.88]));
  const sheepNeck = ownGeometry(loft([[-0.36, 0.13, 0.16, 0], [-0.24, 0.16, 0.20, -0.005], [-0.10, 0.215, 0.245, 0], [0, 0.24, 0.255, 0]], 18, 26, false, true));
  const cowHead = ownGeometry(loft([[-0.535, 0.165, 0.105, -0.075], [-0.435, 0.148, 0.13, -0.050], [-0.285, 0.15, 0.17, -0.010], [-0.105, 0.18, 0.225, 0.035], [0.045, 0.165, 0.235, 0.050], [0.135, 0.095, 0.14, 0.030]], 30, 36, true, false, [0, 1.39, -1.11]));
  const cowMuzzle = ownGeometry(loft([[-0.605, 0.148, 0.08, -0.079], [-0.575, 0.19, 0.107, -0.078], [-0.515, 0.187, 0.11, -0.078], [-0.474, 0.152, 0.096, -0.078]], 14, 28));
  const sheepHead = ownGeometry(loft([[-0.305, 0.097, 0.085, -0.040], [-0.225, 0.119, 0.115, -0.010], [-0.085, 0.137, 0.16, 0.030], [0.045, 0.115, 0.155, 0.046], [0.115, 0.072, 0.105, 0.04]], 24, 28));
  const sheepMuzzle = ownGeometry(loft([[-0.387, 0.082, 0.055, -0.054], [-0.355, 0.108, 0.079, -0.055], [-0.285, 0.101, 0.077, -0.055]], 12, 24));
  const ear = ownGeometry(earGeometry());
  const sphere = ownGeometry(new THREE.SphereGeometry(1, 16, 12));
  const jointSphere = ownGeometry(new THREE.SphereGeometry(1, 10, 8));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(1, 0.62, 1, 12, 3));
  const toe = ownGeometry(new RoundedBoxGeometry(1, 1, 1, 2, 0.18));
  const curls = ownGeometry(new THREE.TorusGeometry(1, 0.30, 4, 9, Math.PI * 1.8));
  const cowTail = ownGeometry(taperedTube([[0, 0, 0], [0.016, -0.29, 0.08], [0.032, -0.63, 0.14], [0.005, -0.94, 0.12]], 0.018, 0.52));
  const tailHair = ownGeometry(taperedTube([[0, 0, 0], [0.012, -0.10, 0.018], [0.008, -0.20, 0.012]], 0.010, 0.12, 10, 5));
  const cowHorn = ownGeometry(taperedTube([[0, 0, 0], [0.025, 0.095, 0.025], [0.055, 0.165, 0.022], [0.067, 0.19, -0.035]], 0.034, 0.04, 13, 8));

  const batches = new Map<string, Batch>(); const animals: Animal[] = [];
  const localObject = new THREE.Object3D();
  const addPart = (parent: THREE.Matrix4, geometry: THREE.BufferGeometry, material: THREE.Material, position: Triple = [0, 0, 0], scale: Triple = [1, 1, 1], rotation: Triple = [0, 0, 0], name?: string, species?: 'cow' | 'sheep') => {
    const key = `${geometry.uuid}:${material.uuid}`;
    let batch = batches.get(key);
    if (!batch) { batch = { geometry, material, parts: [], name, species }; batches.set(key, batch); }
    localObject.position.set(...position); localObject.scale.set(...scale); localObject.rotation.set(...rotation); localObject.updateMatrix();
    batch.parts.push({ parent, local: localObject.matrix.clone() });
  };
  const curlQuaternion = new THREE.Quaternion(); const curlPosition = new THREE.Vector3(); const curlNormal = new THREE.Vector3();
  const forwardNormal = new THREE.Vector3(0, 0, 1); const curlSpin = new THREE.Quaternion();
  const curlScale = new THREE.Vector3(); const section: number[] = [0, 0, 0];

  PASTURES.forEach(field => {
    for (let i = 0; i < field.count; i++) {
      const cow = field.species === 'cow';
      const animal: Animal = {
        species: field.species, field, phase: i * 2.41 + (cow ? 0 : 0.8), radius: 4.5 + (i % 4) * 1.6,
        offset: i * 1.83 + (cow ? 0.4 : 2.2), size: cow ? 0.94 + (i % 3) * 0.043 : 0.89 + (i % 4) * 0.049,
        graze: 0, walk: 0, activityOffset: i / field.count,
        root: new THREE.Matrix4(), head: new THREE.Matrix4(), neck: new THREE.Matrix4(), tail: new THREE.Matrix4(), legs: [],
      };
      animals.push(animal);
      addPart(animal.root, cow ? cowBody : sheepBody, cow ? cowSkin : fleece, [0, 0, 0], [1, 1, 1], [0, 0, 0], cow ? 'Cow bodies' : 'Sheep bodies', field.species);
      addPart(animal.neck, cow ? cowNeck : sheepNeck, cow ? cowSkin : fleece, [0, 0, 0], [1, 1, 1], [0, 0, 0], cow ? 'Cow necks' : 'Sheep necks');
      addPart(animal.head, cow ? cowHead : sheepHead, cow ? cowSkin : sheepFace, [0, 0, 0], [1, 1, 1], [0, 0, 0], cow ? 'Cow heads' : 'Sheep heads');
      if (cow) {
        addPart(animal.head, cowMuzzle, nose, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'Cow muzzles');
        // Nose openings sit inside the flared nose mirror, with a lower lip and chin.
        for (const side of [-1, 1]) {
          addPart(animal.head, sphere, nostril, [side * 0.117, -0.051, -0.577], [0.040, 0.027, 0.016], [0.18, side * 0.36, side * 0.16]);
          addPart(animal.head, sphere, eyeRim, [side * 0.175, 0.073, -0.120], [0.025, 0.052, 0.070], [0, side * 0.16, 0]);
          addPart(animal.head, sphere, eye, [side * 0.197, 0.074, -0.135], [0.015, 0.027, 0.037]);
          addPart(animal.head, ear, earOuter, [side * 0.151, 0.181, 0.05], [1, 1, 1], [side * 0.1, side < 0 ? Math.PI : 0, -side * 0.09]);
          addPart(animal.head, ear, earInner, [side * 0.184, 0.191, 0.05], [0.68, 0.75, 0.72], [side * 0.1, side < 0 ? Math.PI : 0, -side * 0.09]);
          addPart(animal.head, cowHorn, horn, [side * 0.14, 0.225, 0.045], [1, 1, 1], [0, side < 0 ? Math.PI : 0, -side * 0.18]);
        }
        addPart(animal.head, sphere, nose, [0, -0.174, -0.527], [0.163, 0.026, 0.073]);
        addPart(animal.root, sphere, udder, [0, 0.745, 0.53], [0.213, 0.13, 0.192]);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) addPart(animal.root, cylinder, udder, [sx * 0.075, 0.607, 0.53 + sz * 0.075], [0.025, 0.10, 0.025], [0, 0, sx * 0.10]);
        addPart(animal.tail, cowTail, whiteCoat);
        for (let strand = 0; strand < 7; strand++) addPart(animal.tail, tailHair, blackCoat, [Math.cos(strand * 2.39) * 0.03, -0.88, 0.12 + Math.sin(strand * 2.39) * 0.029], [1, 1 + strand * 0.045, 1]);
      } else {
        addPart(animal.head, sheepMuzzle, nose, [0, 0, 0], [1, 1, 1], [0, 0, 0], 'Sheep muzzles');
        for (const side of [-1, 1]) {
          addPart(animal.head, sphere, eyeRim, [side * 0.133, 0.060, -0.115], [0.018, 0.033, 0.044]);
          addPart(animal.head, sphere, eye, [side * 0.147, 0.061, -0.128], [0.009, 0.020, 0.025]);
          addPart(animal.head, sphere, nostril, [side * 0.053, -0.039, -0.370], [0.019, 0.014, 0.013], [0, side * 0.35, 0]);
          addPart(animal.head, ear, sheepSkin, [side * 0.111, 0.155, 0.016], [0.76, 0.80, 0.68], [0.0, side < 0 ? Math.PI : 0, -side * 0.16]);
          addPart(animal.head, ear, sheepEarInner, [side * 0.138, 0.161, 0.016], [0.46, 0.60, 0.43], [0.0, side < 0 ? Math.PI : 0, -side * 0.16]);
        }
        addPart(animal.head, sphere, sheepSkin, [0, -0.130, -0.289], [0.087, 0.020, 0.086]);
        addPart(animal.tail, sphere, fleece, [0, -0.064, 0.036], [0.054, 0.15, 0.07]);
        // Hundreds of centimetre-scale curls add a fine, broken wool silhouette.
        // The bump map fills the gaps; no large spherical tuft objects are used.
        for (let curl = 0; curl < 136; curl++) {
          const z = THREE.MathUtils.lerp(-0.58, 0.61, (curl + 0.5) / 136);
          const theta = curl * 2.3999632297 + i * 0.7;
          sectionAt(SHEEP_BODY, z, section);
          const c = Math.cos(theta); const s = Math.sin(theta);
          curlPosition.set(section[0] * c, section[2] + section[1] * s, z);
          curlNormal.set(c / Math.max(0.10, section[0]), s / Math.max(0.14, section[1]), 0.10 * Math.sin(curl * 1.32)).normalize();
          curlPosition.addScaledVector(curlNormal, 0.009);
          curlQuaternion.setFromUnitVectors(forwardNormal, curlNormal);
          curlSpin.setFromAxisAngle(forwardNormal, curl * 1.79); curlQuaternion.multiply(curlSpin);
          const radius = 0.020 + hash(curl, i, 7) * 0.013;
          curlScale.set(radius, radius * (0.8 + hash(i, curl, 3) * 0.4), radius);
          const key = `${curls.uuid}:${fleeceTips.uuid}`;
          let batch = batches.get(key);
          if (!batch) { batch = { geometry: curls, material: fleeceTips, parts: [] }; batches.set(key, batch); }
          batch.parts.push({ parent: animal.root, local: new THREE.Matrix4().compose(curlPosition, curlQuaternion, curlScale) });
        }
      }

      for (let legIndex = 0; legIndex < 4; legIndex++) {
        const front = legIndex < 2; const side = legIndex % 2 ? -1 : 1;
        const leg: Leg = {
          front, side, phase: (legIndex === 0 || legIndex === 3 ? 0 : Math.PI),
          points: Array.from({ length: 4 }, () => new THREE.Vector3()),
          bones: Array.from({ length: 3 }, () => new THREE.Matrix4()), joints: Array.from({ length: 3 }, () => new THREE.Matrix4()), foot: new THREE.Matrix4(),
        };
        animal.legs.push(leg);
        const skin = cow ? (legIndex === (i % 4) || legIndex === ((i + 1) % 4) ? blackCoat : whiteCoat) : sheepSkin;
        for (let bone = 0; bone < 3; bone++) addPart(leg.bones[bone], cylinder, skin);
        for (let joint = 0; joint < 3; joint++) {
          const radius = cow ? (joint === 0 ? 0.079 : joint === 1 ? 0.055 : 0.049) : (joint === 0 ? 0.044 : 0.035);
          addPart(leg.joints[joint], jointSphere, skin, [0, 0, 0], [radius, radius * 1.12, radius]);
        }
        for (const sx of [-1, 1]) {
          addPart(leg.foot, toe, hoof, [sx * (cow ? 0.042 : 0.025), cow ? 0.057 : 0.041, -0.022], cow ? [0.073, 0.108, 0.161] : [0.043, 0.073, 0.098], [0, 0, -sx * 0.04]);
          if (cow) addPart(leg.foot, jointSphere, hoof, [sx * 0.041, 0.16, 0.042], [0.021, 0.034, 0.02]);
        }
      }
    }
  });

  batches.forEach(batch => {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.parts.length);
    mesh.name = batch.name ?? 'Livestock anatomical details';
    if (batch.species) mesh.userData.species = batch.species;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = mesh.receiveShadow = true;
    // Every instance moves inside its pasture. Disabling batch culling avoids a
    // stale initial bounding sphere, while the entire village remains small.
    mesh.frustumCulled = false; batch.mesh = mesh; group.add(mesh);
  });

  // The static anatomy is uploaded once. Every moving parent and final part
  // matrix is evaluated together in Rust; Three only receives the packed result.
  const parents = new Map<THREE.Matrix4, number>();
  if (runtime) for (const animal of animals) {
    for (const parent of [animal.root, animal.head, animal.neck, animal.tail,
      ...animal.legs.flatMap(leg => [...leg.bones, ...leg.joints, leg.foot])]) parents.set(parent, parents.size);
  }
  const simulation = runtime ? createLivestockSimulation(runtime, animals,
    [...batches.values()].flatMap(batch => batch.parts.map(part => ({ parent: parents.get(part.parent)!, local: part.local.elements }))), world) : undefined;

  const rootPosition = new THREE.Vector3(); const headPosition = new THREE.Vector3(); const neckOrigin = new THREE.Vector3();
  const rootScale = new THREE.Vector3(); const unitScale = new THREE.Vector3(1, 1, 1); const boneScale = new THREE.Vector3();
  const direction = new THREE.Vector3(); const midpoint = new THREE.Vector3(); const axisY = new THREE.Vector3(0, 1, 0); const axisForward = new THREE.Vector3(0, 0, -1);
  const quaternion = new THREE.Quaternion(); const rootQuaternion = new THREE.Quaternion(); const euler = new THREE.Euler();
  const localMatrix = new THREE.Matrix4(); const resultMatrix = new THREE.Matrix4();
  let previousTime: number | null = null; let disposed = false;
  const update = (time: number) => {
    if (disposed) return;
    if (simulation) {
      const matrices = simulation.update(time);
      let offset = 0;
      batches.forEach(batch => {
        const length = batch.parts.length * 16;
        batch.mesh!.instanceMatrix.array.set(matrices.subarray(offset, offset + length));
        batch.mesh!.instanceMatrix.needsUpdate = true;
        offset += length;
      });
      return;
    }
    const dt = previousTime === null ? 0 : THREE.MathUtils.clamp(time - previousTime, 0, 0.08); previousTime = time;
    for (const animal of animals) {
      const cow = animal.species === 'cow';
      // Offset complete feeding/resting/walking cycles across each herd. Only
      // a few animals lower their heads fully at once; the others chew or walk.
      const activity = (time / (cow ? 32 : 28) + animal.activityOffset) % 1;
      const grazeTarget = THREE.MathUtils.smoothstep(activity, 0.08, 0.18)
        * (1 - THREE.MathUtils.smoothstep(activity, 0.40, 0.53));
      const walkTarget = THREE.MathUtils.smoothstep(activity, 0.60, 0.70)
        * (1 - THREE.MathUtils.smoothstep(activity, 0.91, 1));
      animal.graze += (grazeTarget - animal.graze) * Math.min(1, dt * 3.2);
      animal.walk += (walkTarget - animal.walk) * Math.min(1, dt * 3.2);
      const walking = animal.walk;
      animal.phase += dt * (cow ? 0.065 : 0.083) * walking;
      const x = animal.field.x + Math.cos(animal.phase) * animal.radius;
      const z = animal.field.z + Math.sin(animal.phase) * animal.radius * 0.77;
      const heading = Math.atan2(Math.sin(animal.phase), -Math.cos(animal.phase) * 0.77);
      rootPosition.set(x, groundHeight(x, z) + Math.sin(time * 3.5 + animal.offset) * 0.008 * walking, z);
      euler.set(0, heading, Math.sin(time * 0.68 + animal.offset) * 0.006);
      rootQuaternion.setFromEuler(euler); rootScale.setScalar(animal.size);
      animal.root.compose(rootPosition, rootQuaternion, rootScale);
      const g = animal.graze;
      const nibble = Math.sin(time * 5.3 + animal.offset) * g * 0.008;
      headPosition.set(0, (cow ? 1.39 - g * 0.69 : 0.98 - g * 0.50) + nibble, cow ? -1.11 - g * 0.11 : -0.71 - g * 0.065);
      euler.set((cow ? -0.10 - g * 0.92 : -0.06 - g * 0.79) + Math.sin(time * 1.1 + animal.offset) * 0.012,
        Math.sin(time * 0.7 + animal.offset) * (g > 0.8 ? 0.024 : 0.055), 0);
      quaternion.setFromEuler(euler); localMatrix.compose(headPosition, quaternion, unitScale); animal.head.multiplyMatrices(animal.root, localMatrix);
      neckOrigin.set(0, cow ? 1.18 : 0.80, cow ? -0.88 : -0.47);
      direction.copy(headPosition).sub(neckOrigin); const neckLength = direction.length(); direction.normalize();
      quaternion.setFromUnitVectors(axisForward, direction); boneScale.set(1, 1, neckLength / (cow ? 0.55 : 0.36));
      localMatrix.compose(neckOrigin, quaternion, boneScale); animal.neck.multiplyMatrices(animal.root, localMatrix);
      midpoint.set(0, cow ? 1.45 : 0.88, cow ? 0.94 : 0.65);
      euler.set(0.035 * Math.sin(time * 0.91 + animal.offset), Math.sin(time * 0.80 + animal.offset) * 0.10, Math.sin(time * 1.7 + animal.offset) * (cow ? 0.13 : 0.08));
      quaternion.setFromEuler(euler); localMatrix.compose(midpoint, quaternion, unitScale); animal.tail.multiplyMatrices(animal.root, localMatrix);

      for (const leg of animal.legs) {
        const cycle = time * (cow ? 2.7 : 3.3) + animal.offset + leg.phase;
        const stride = Math.sin(cycle) * (cow ? 0.14 : 0.10) * walking;
        const lift = Math.max(0, Math.cos(cycle)) * (cow ? 0.073 : 0.059) * walking;
        const spread = leg.side * (cow ? 0.31 : 0.215);
        const p = leg.points;
        if (cow) {
          p[0].set(spread, leg.front ? 1.22 : 1.25, leg.front ? -0.63 : 0.68);
          p[1].set(spread * 1.02, 0.78 + lift * 0.22, (leg.front ? -0.565 : 0.49) + stride * 0.32);
          p[2].set(spread * 1.035, 0.44 + lift * 0.65, (leg.front ? -0.665 : 0.775) + stride * 0.60);
          p[3].set(spread * 1.06, 0.158 + lift, (leg.front ? -0.66 : 0.645) + stride);
        } else {
          p[0].set(spread, 0.81, leg.front ? -0.40 : 0.43);
          p[1].set(spread * 1.02, 0.51 + lift * 0.22, (leg.front ? -0.37 : 0.32) + stride * 0.34);
          p[2].set(spread * 1.035, 0.27 + lift * 0.65, (leg.front ? -0.43 : 0.50) + stride * 0.62);
          p[3].set(spread * 1.06, 0.108 + lift, (leg.front ? -0.43 : 0.42) + stride);
        }
        for (let bone = 0; bone < 3; bone++) {
          direction.copy(p[bone]).sub(p[bone + 1]); const length = direction.length(); direction.normalize();
          midpoint.copy(p[bone]).add(p[bone + 1]).multiplyScalar(0.5); quaternion.setFromUnitVectors(axisY, direction);
          const radius = cow ? (bone === 0 ? (leg.front ? 0.130 : 0.145) : bone === 1 ? 0.064 : 0.046) : (bone === 0 ? 0.067 : bone === 1 ? 0.041 : 0.030);
          boneScale.set(radius, length, radius * (bone === 0 ? 1.18 : 1));
          localMatrix.compose(midpoint, quaternion, boneScale); leg.bones[bone].multiplyMatrices(animal.root, localMatrix);
          localMatrix.makeTranslation(p[bone + 1].x, p[bone + 1].y, p[bone + 1].z); leg.joints[bone].multiplyMatrices(animal.root, localMatrix);
        }
        localMatrix.makeTranslation(p[3].x, lift, p[3].z); leg.foot.multiplyMatrices(animal.root, localMatrix);
      }
    }
    batches.forEach(batch => {
      for (let i = 0; i < batch.parts.length; i++) {
        const part = batch.parts[i]; resultMatrix.multiplyMatrices(part.parent, part.local); batch.mesh!.setMatrixAt(i, resultMatrix);
      }
      batch.mesh!.instanceMatrix.needsUpdate = true;
    });
  };
  update(0);
  return {
    group,
    update,
    dispose() {
      if (disposed) return; disposed = true;
      simulation?.dispose();
      batches.forEach(batch => batch.mesh?.dispose()); geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()); group.clear();
    },
  };
}
