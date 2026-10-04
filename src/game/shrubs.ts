import * as THREE from 'three';

export interface ShrubPlacement {
  x: number;
  y: number;
  z: number;
  height: number;
  seed?: number;
}

const MAX_LEAVES_PER_SHRUB = 190;
const MAX_BRANCHES_PER_SHRUB = 55;

function randomGenerator(seed: number) {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** An eight-triangle, pointed blade with a raised midrib and curled margins. */
function leafGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    -0.19, 0.3, -0.026, 0, 0.3, 0.024, 0.19, 0.3, -0.019,
    -0.24, 0.67, -0.003, 0, 0.67, 0.058, 0.24, 0.67, -0.015,
    0.008, 1, -0.045,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0.5, 0, 0, 0.3, 0.5, 0.3, 1, 0.3, 0, 0.67, 0.5, 0.67, 1, 0.67, 0.5, 1,
  ], 2));
  geometry.setIndex([0, 2, 1, 0, 3, 2, 1, 2, 5, 1, 5, 4, 2, 3, 6, 2, 6, 5, 4, 5, 7, 5, 6, 7]);
  geometry.computeVertexNormals();
  return geometry;
}

/** Branch-attached foliage in three shared draws, with a sparse shadow canopy. */
export function createShrubs(placements: ShrubPlacement[]) {
  const group = new THREE.Group();
  group.name = 'Natural branching riverside shrubs';
  const valid = placements.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)
    && Number.isFinite(p.z) && Number.isFinite(p.height) && p.height > 0);
  const capacity = Math.max(1, valid.length);
  const branchGeometry = new THREE.CylinderGeometry(0.6, 1, 1, 5, 1, true);
  const leafBlade = leafGeometry();
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.91, metalness: 0, side: THREE.DoubleSide,
  });
  const branchMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.96, metalness: 0,
  });
  const shadowMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const windTime = { value: 0 };
  type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];
  const addWind = (shader: Shader, detail: boolean) => {
    shader.uniforms.shrubTime = windTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      attribute float leafPhase;
      uniform float shrubTime;
      ${detail ? 'varying vec2 vShrubUv; varying float vShrubPhase; varying float vShrubDistance;' : ''}
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float leafTip = position.y * position.y;
      transformed.x += sin(shrubTime * 0.95 + leafPhase) * 0.055 * leafTip;
      transformed.z += cos(shrubTime * 1.3 + leafPhase * 1.91) * 0.065 * leafTip;
      ${detail ? `
        vShrubUv = uv; vShrubPhase = leafPhase;
        vShrubDistance = distance(cameraPosition, (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
      ` : ''}
    `);
    if (detail) shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec2 vShrubUv; varying float vShrubPhase; varying float vShrubDistance;
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      // Fine foliage becomes sparse at long range; nearer silhouettes retain all blades.
      if (fract(vShrubPhase * 0.371) < smoothstep(240.0, 700.0, vShrubDistance) * 0.64) discard;
      float veinWidth = max(fwidth(vShrubUv.x) * 1.2, 0.012);
      float midrib = 1.0 - smoothstep(veinWidth, veinWidth * 2.5, abs(vShrubUv.x - 0.5));
      float veinCycle = abs(fract(vShrubUv.y * 6.5 + abs(vShrubUv.x - 0.5) * 4.5) - 0.5);
      float sideVeins = 1.0 - smoothstep(0.025, 0.075, veinCycle);
      float bladeVariation = 0.92 + 0.06 * sin(vShrubUv.y * 15.0 + vShrubPhase);
      diffuseColor.rgb *= bladeVariation + midrib * 0.12 + sideVeins * 0.035;
      diffuseColor.rgb *= gl_FrontFacing ? 1.0 : 1.1;
    `);
  };
  leafMaterial.onBeforeCompile = shader => addWind(shader, true);
  leafMaterial.customProgramCacheKey = () => 'curved-shrub-leaves-with-veins-v1';
  shadowMaterial.onBeforeCompile = shader => addWind(shader, false);
  shadowMaterial.customProgramCacheKey = () => 'curved-shrub-leaf-shadow-wind-v1';

  const makeLeaves = (name: string, maxCount: number, shadows: boolean) => {
    const geometry = leafBlade.clone();
    const phases = new THREE.InstancedBufferAttribute(new Float32Array(maxCount), 1);
    geometry.setAttribute('leafPhase', phases);
    const mesh = new THREE.InstancedMesh(geometry, leafMaterial, maxCount);
    mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true;
    mesh.customDepthMaterial = shadowMaterial;
    mesh.setColorAt(0, new THREE.Color('#516841'));
    group.add(mesh);
    return { mesh, geometry, phases, count: 0 };
  };
  const leaves = makeLeaves('Shrub curved blades / main foliage', capacity * MAX_LEAVES_PER_SHRUB, false);
  const shadowLeaves = makeLeaves('Shrub curved blades / sparse shadow foliage', capacity * 28, true);
  const branches = new THREE.InstancedMesh(branchGeometry, branchMaterial, capacity * MAX_BRANCHES_PER_SHRUB);
  branches.name = 'Shrub stems / branching woody framework';
  branches.castShadow = true; branches.receiveShadow = true;
  group.add(branches);

  const transform = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const right = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const roll = new THREE.Quaternion();
  const leafColor = new THREE.Color();
  const twigColor = new THREE.Color();
  const darkGreen = new THREE.Color('#3c5133');
  const green = new THREE.Color('#657647');
  const newGreen = new THREE.Color('#818958');
  const wood = new THREE.Color('#635b45');
  let branchCount = 0;

  const addBranch = (a: THREE.Vector3, b: THREE.Vector3, radius: number, shade: number) => {
    direction.subVectors(b, a);
    const length = direction.length();
    if (length < 0.0001) return;
    transform.position.copy(a).add(b).multiplyScalar(0.5);
    transform.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / length));
    transform.scale.set(radius, length, radius);
    transform.updateMatrix(); branches.setMatrixAt(branchCount, transform.matrix);
    twigColor.copy(wood).multiplyScalar(shade); branches.setColorAt(branchCount++, twigColor);
  };

  valid.forEach((placement, plantIndex) => {
    const plantSeed = placement.seed ?? (Math.imul(Math.round(placement.x * 17), 73856093)
      ^ Math.imul(Math.round(placement.z * 19), 19349663) ^ plantIndex * 83492791);
    const random = randomGenerator(plantSeed);
    const height = placement.height;
    const stemCount = 4 + Math.floor(random() * 2);
    const baseAngle = random() * Math.PI * 2;
    const origin = new THREE.Vector3(placement.x, placement.y, placement.z);
    let plantLeafCount = 0;
    const addLeaf = (at: THREE.Vector3, angle: number, elevation: number, youth: number) => {
      const size = height * (0.135 + random() * 0.085);
      direction.set(Math.cos(angle) * Math.cos(elevation), Math.sin(elevation), Math.sin(angle) * Math.cos(elevation)).normalize();
      normal.copy(up).addScaledVector(direction, -up.dot(direction)).normalize();
      roll.setFromAxisAngle(direction, (random() - 0.5) * 1.3); normal.applyQuaternion(roll);
      right.crossVectors(direction, normal).normalize(); normal.crossVectors(right, direction).normalize();
      basis.makeBasis(right, direction, normal);
      transform.position.copy(at); transform.quaternion.setFromRotationMatrix(basis);
      transform.scale.set(size * (1.0 + random() * 0.75), size, size);
      transform.updateMatrix();
      const field = plantLeafCount % 7 === 0 ? shadowLeaves : leaves;
      field.mesh.setMatrixAt(field.count, transform.matrix);
      leafColor.copy(darkGreen).lerp(green, 0.2 + random() * 0.65).lerp(newGreen, youth * (0.12 + random() * 0.24));
      leafColor.multiplyScalar(0.86 + random() * 0.18);
      field.mesh.setColorAt(field.count, leafColor);
      field.phases.setX(field.count++, random() * Math.PI * 2 + plantIndex * 0.73);
      plantLeafCount++;
    };

    for (let stem = 0; stem < stemCount; stem++) {
      const angle = baseAngle + stem * Math.PI * 2 / stemCount + (random() - 0.5) * 0.45;
      const spread = height * (0.30 + random() * 0.32);
      const stemHeight = height * (0.63 + random() * 0.34);
      const a = origin.clone().add(new THREE.Vector3(Math.cos(angle) * height * 0.035, height * 0.035, Math.sin(angle) * height * 0.035));
      const b = origin.clone().add(new THREE.Vector3(Math.cos(angle) * spread * 0.13, stemHeight * 0.35, Math.sin(angle) * spread * 0.13));
      const c = origin.clone().add(new THREE.Vector3(Math.cos(angle) * spread * 0.57, stemHeight * 0.73, Math.sin(angle) * spread * 0.57));
      const d = origin.clone().add(new THREE.Vector3(Math.cos(angle) * spread, stemHeight, Math.sin(angle) * spread));
      const curve = new THREE.CubicBezierCurve3(a, b, c, d);
      for (let segment = 0; segment < 3; segment++) {
        addBranch(curve.getPoint(segment / 3), curve.getPoint((segment + 1) / 3), height * 0.011 * (1 - segment * 0.23), 0.78 + random() * 0.26);
      }
      for (let shoot = 0; shoot < 4; shoot++) {
        const attach = curve.getPoint(0.26 + shoot * 0.19);
        const shootAngle = angle + (shoot % 2 ? -1 : 1) * (0.65 + random() * 0.8);
        const shootLength = height * (0.16 + random() * 0.2) * (1 - shoot * 0.12);
        const middle = attach.clone().add(new THREE.Vector3(Math.cos(shootAngle) * shootLength * 0.5,
          height * (0.05 + random() * 0.07), Math.sin(shootAngle) * shootLength * 0.5));
        const tip = attach.clone().add(new THREE.Vector3(Math.cos(shootAngle) * shootLength,
          height * (0.045 + random() * 0.12), Math.sin(shootAngle) * shootLength));
        const twig = new THREE.QuadraticBezierCurve3(attach, middle, tip);
        addBranch(attach, twig.getPoint(0.5), height * 0.0036, 0.88 + random() * 0.23);
        addBranch(twig.getPoint(0.5), tip, height * 0.0025, 0.88 + random() * 0.23);
        for (const station of [0.20, 0.41, 0.63, 0.85]) for (const side of [-1, 1]) {
          const point = twig.getPoint(station);
          addLeaf(point, shootAngle + side * (0.85 + random() * 0.3), 0.08 + random() * 0.45, station * 0.65);
        }
        addLeaf(twig.getPoint(0.96), shootAngle + (random() - 0.5) * 0.7, 0.2 + random() * 0.4, 0.95);
      }
      addLeaf(curve.getPoint(0.9), angle + 0.7, 0.38 + random() * 0.35, 0.85);
      addLeaf(d, angle - 0.45, 0.38 + random() * 0.35, 1);
    }
  });

  branches.count = branchCount; branches.instanceMatrix.needsUpdate = true;
  if (branches.instanceColor) branches.instanceColor.needsUpdate = true;
  branches.computeBoundingSphere();
  for (const field of [leaves, shadowLeaves]) {
    field.mesh.count = field.count; field.mesh.instanceMatrix.needsUpdate = true;
    field.mesh.instanceColor!.needsUpdate = true; field.phases.needsUpdate = true;
    field.mesh.computeBoundingSphere();
  }
  group.userData.plantCount = valid.length;
  group.userData.leafCount = leaves.count + shadowLeaves.count;
  group.userData.leafTriangles = (leaves.count + shadowLeaves.count) * 8;
  group.userData.branchCount = branchCount;
  let disposed = false;
  return {
    group,
    update(time: number) { if (!disposed && Number.isFinite(time)) windTime.value = time; },
    dispose() {
      if (disposed) return; disposed = true;
      branches.dispose(); leaves.mesh.dispose(); shadowLeaves.mesh.dispose();
      branchGeometry.dispose(); leafBlade.dispose(); leaves.geometry.dispose(); shadowLeaves.geometry.dispose();
      branchMaterial.dispose(); leafMaterial.dispose(); shadowMaterial.dispose();
      group.clear(); group.removeFromParent();
    },
  };
}
