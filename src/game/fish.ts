import * as THREE from 'three';
import { FISH_SCHOOLS } from './rural-layout.ts';
import { WATER_LEVEL } from './landscape.ts';

/** Close, coherent shoals of silver river fish and bronze carp, below the water surface. */
export function createFish() {
  const group = new THREE.Group();
  group.name = 'River and lake fish schools';
  const count = FISH_SCHOOLS.reduce((sum, school) => sum + school.count, 0);
  const pathLengths = FISH_SCHOOLS.map(school => school.points.reduce((length, point, index) => {
    const next = school.points[(index + 1) % school.points.length];
    return length + Math.hypot(next.x - point.x, next.z - point.z);
  }, 0));
  const profile = [
    [0, -0.54], [0.035, -0.44], [0.08, -0.32], [0.135, -0.13],
    [0.16, 0.08], [0.12, 0.32], [0.068, 0.49], [0.018, 0.57], [0, 0.59],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bodyGeometry = new THREE.LatheGeometry(profile, 18);
  bodyGeometry.rotateX(-Math.PI / 2);
  bodyGeometry.scale(1, 0.78, 1);
  const vertices = bodyGeometry.attributes.position;
  const colors = new Float32Array(vertices.count * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i);
    const z = vertices.getZ(i);
    const back = THREE.MathUtils.smoothstep(y, -0.01, 0.10);
    tint.set('#d5ddbf').lerp(new THREE.Color('#354d41'), back * 0.82);
    // A fine, irregular scale pattern catches light without glowing through the surface.
    const scale = 0.93 + Math.sin(z * 102 + Math.sin(vertices.getX(i) * 80)) * 0.07;
    tint.multiplyScalar(scale);
    colors.set([tint.r, tint.g, tint.b], i * 3);
  }
  bodyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.37, metalness: 0.12 });
  const finMaterial = new THREE.MeshStandardMaterial({ color: '#96a88a', side: THREE.DoubleSide, roughness: 0.65 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: '#0c1712', roughness: 0.18 });
  const gillMaterial = new THREE.MeshStandardMaterial({ color: '#4b6150', roughness: 0.65 });
  const finGeometry = new THREE.BufferGeometry();
  finGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0, 0.23, 0.36, 0, 0.05, 0.25,
    0, 0, 0, 0, 0.05, 0.25, 0, -0.05, 0.25,
    0, 0, 0, 0, -0.05, 0.25, 0, -0.23, 0.36,
  ], 3));
  finGeometry.computeVertexNormals();
  const dorsalGeometry = new THREE.BufferGeometry();
  dorsalGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.17, 0, 0.16, -0.10, 0, 0.025, 0.22,
  ], 3));
  dorsalGeometry.computeVertexNormals();
  const eyeGeometry = new THREE.SphereGeometry(1, 8, 6);
  const gillGeometry = new THREE.TorusGeometry(0.11, 0.005, 3, 12, Math.PI * 0.75);
  const meshes: THREE.InstancedMesh[] = [];
  const batch = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    group.add(mesh); meshes.push(mesh);
    return mesh;
  };
  const bodies = batch('Fish bodies', bodyGeometry, bodyMaterial, count);
  const tails = batch('Forked fish tails', finGeometry, finMaterial, count);
  const dorsals = batch('Fish dorsal fins', dorsalGeometry, finMaterial, count);
  const pectorals = batch('Fish pectoral fins', finGeometry, finMaterial, count * 2);
  const eyes = batch('Fish eyes', eyeGeometry, eyeMaterial, count * 2);
  const gills = batch('Fish gills', gillGeometry, gillMaterial, count * 2);
  for (let i = 0; i < count; i++) bodies.setColorAt(i, new THREE.Color(i % 4 === 0 ? '#d3aa65' : '#ecf0df'));
  const root = new THREE.Object3D();
  const part = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  const put = (mesh: THREE.InstancedMesh, slot: number, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
    part.position.set(x, y, z); part.scale.set(sx, sy, sz); part.rotation.set(rx, ry, rz); part.updateMatrix();
    mesh.setMatrixAt(slot, matrix.multiplyMatrices(root.matrix, part.matrix));
  };
  let disposed = false;
  const update = (time: number) => {
    if (disposed) return;
    let slot = 0;
    FISH_SCHOOLS.forEach((school, schoolIndex) => {
      for (let fish = 0; fish < school.count; fish++, slot++) {
        // Small phase offsets keep neighbours together instead of scattering them around a lake.
        const stagger = Math.sin((fish % 6) * 1.83) * 0.45;
        const rowOffset = (Math.floor(fish / 6) * 3.3 + stagger) / pathLengths[schoolIndex];
        const progress = ((time * 0.010 + schoolIndex * 0.17 - rowOffset) % 1 + 1) % 1;
        const sample = progress * school.points.length;
        const index = Math.floor(sample);
        const fraction = sample - index;
        const a = school.points[index];
        const b = school.points[(index + 1) % school.points.length];
        const before = school.points[(index - 1 + school.points.length) % school.points.length];
        const after = school.points[(index + 2) % school.points.length];
        const dx = THREE.MathUtils.lerp(b.x - before.x, after.x - a.x, fraction);
        const dz = THREE.MathUtils.lerp(b.z - before.z, after.z - a.z, fraction);
        const length = Math.hypot(dx, dz);
        const lateral = ((fish % 6) - 2.5) * school.spread * 0.32 + Math.sin(time * 0.8 + fish * 2.1) * 0.11;
        const x = THREE.MathUtils.lerp(a.x, b.x, fraction) - dz / length * lateral;
        const z = THREE.MathUtils.lerp(a.z, b.z, fraction) + dx / length * lateral;
        const size = 0.82 + (fish % 5) * 0.085;
        root.position.set(x, WATER_LEVEL - 0.34 - (fish % 3) * 0.085 + Math.sin(time * 0.9 + fish) * 0.025, z);
        root.rotation.set(0, Math.atan2(-dx, -dz), Math.sin(time * 1.3 + fish) * 0.035);
        root.scale.setScalar(size); root.updateMatrix();
        bodies.setMatrixAt(slot, root.matrix);
        put(tails, slot, 0, 0, 0.49, 1, 0.85, 1, 0, Math.sin(time * 7 + fish * 0.6) * 0.45);
        put(dorsals, slot, 0, 0.10, 0, 1, 1, 1);
        for (const side of [-1, 1]) {
          const pair = slot * 2 + (side === 1 ? 1 : 0);
          put(pectorals, pair, side * 0.10, -0.035, -0.04, 0.6, 0.63, 0.65, 0, side * (0.72 + Math.sin(time * 3 + fish) * 0.05), side * Math.PI / 2);
          put(eyes, pair, side * 0.082, 0.025, -0.425, 0.022, 0.022, 0.022);
          put(gills, pair, side * 0.065, 0, -0.27, 0.7, 1, 1, 0, side * Math.PI / 2, Math.PI * 0.16);
        }
      }
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return {
    group, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of [bodyGeometry, finGeometry, dorsalGeometry, eyeGeometry, gillGeometry]) geometry.dispose();
      for (const material of [bodyMaterial, finMaterial, eyeMaterial, gillMaterial]) material.dispose();
      group.clear(); group.removeFromParent();
    },
  };
}
