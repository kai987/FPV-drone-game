import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BLAST_RADIUS, EXPLOSION_LIFETIME, MAX_ACTIVE_BOMBS, MAX_ACTIVE_EXPLOSIONS, TARGETS,
} from './weapons';
import type { WeaponState } from './weapons';
import { groundHeight } from './world';
import { isWater, WATER_LEVEL } from './landscape';

/** Geometry, target feedback and pooled effects for the fictional practice game. */
export function createWeaponVisuals() {
  const group = new THREE.Group();
  group.name = 'Training targets and game effects';
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  const ownMaterial = <T extends THREE.Material>(material: T): T => {
    materials.add(material);
    return material;
  };
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  const orange = new THREE.Color('#e88335');
  const cream = new THREE.Color('#ece5d5');
  const lime = new THREE.Color('#cadd55');
  const dark = new THREE.Color('#263e30');
  const unitCylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 48));
  const roundedBox = ownGeometry(new RoundedBoxGeometry(1, 1, 1, 2, 0.1));
  const unitBox = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const targetMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.84, metalness: 0.06,
  }));
  const poleMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#47584a', metalness: 0.46, roughness: 0.48,
  }));
  const creamMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#eee7d7', roughness: 0.56, metalness: 0.1 }));
  const rimMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#d7e968', emissive: '#a8cc39', emissiveIntensity: 0.5, roughness: 0.65,
  }));
  const checkMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#e0ef88', emissive: '#a8cc39', emissiveIntensity: 0.28, roughness: 0.65, side: THREE.DoubleSide,
  }));

  // Instancing keeps all five layered bull's-eyes, crates and marker poles cheap.
  const padLayers = Array.from({ length: 4 }, () => {
    const layer = new THREE.InstancedMesh(unitCylinder, targetMaterial, TARGETS.length);
    layer.receiveShadow = true;
    group.add(layer);
    return layer;
  });
  const rimGeometry = ownGeometry(new THREE.RingGeometry(0.97, 1.03, 48));
  rimGeometry.rotateX(-Math.PI / 2);
  const rims = new THREE.InstancedMesh(rimGeometry, rimMaterial, TARGETS.length);
  group.add(rims);
  const checkShape = new THREE.Shape();
  checkShape.moveTo(-0.67, -0.01);
  checkShape.lineTo(-0.36, -0.36);
  checkShape.lineTo(0.58, 0.57);
  checkShape.lineTo(0.74, 0.41);
  checkShape.lineTo(-0.35, -0.66);
  checkShape.lineTo(-0.84, -0.16);
  checkShape.closePath();
  const checkGeometry = ownGeometry(new THREE.ShapeGeometry(checkShape));
  checkGeometry.rotateX(-Math.PI / 2);
  const checks = new THREE.InstancedMesh(checkGeometry, checkMaterial, TARGETS.length);
  group.add(checks);
  const crates = new THREE.InstancedMesh(roundedBox, targetMaterial, TARGETS.length * 2);
  const crateStraps = new THREE.InstancedMesh(unitBox, creamMaterial, TARGETS.length * 2);
  crates.castShadow = true;
  crates.receiveShadow = true;
  group.add(crates, crateStraps);
  const poleGeometry = ownGeometry(new THREE.CylinderGeometry(0.035, 0.049, 1.8, 8));
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, TARGETS.length);
  poles.castShadow = true;
  group.add(poles);
  const flagGeometry = ownGeometry(new THREE.PlaneGeometry(1.18, 0.72, 6, 2));
  const flagVertices = flagGeometry.attributes.position;
  for (let i = 0; i < flagVertices.count; i++) {
    flagVertices.setZ(i, Math.sin(flagVertices.getX(i) * 7.5) * 0.05);
  }
  flagGeometry.computeVertexNormals();
  const flagMaterials: THREE.MeshStandardMaterial[] = [];
  const targetHeights = TARGETS.map(target => groundHeight(target.position.x, target.position.z));
  const hitStates = TARGETS.map(() => false);
  const radiusScales = [1, 0.76, 0.48, 0.2];

  TARGETS.forEach((target, index) => {
    const { x, z } = target.position;
    const y = targetHeights[index];
    padLayers.forEach((layer, layerIndex) => {
      transform.position.set(x, y + (layerIndex === 0 ? 0.07 : 0.15 + layerIndex * 0.007), z);
      transform.rotation.set(0, index * 0.4, 0);
      transform.scale.set(target.radius * radiusScales[layerIndex], layerIndex === 0 ? 0.14 : 0.009, target.radius * radiusScales[layerIndex]);
      transform.updateMatrix();
      layer.setMatrixAt(index, transform.matrix);
      layer.setColorAt(index, layerIndex % 2 === 0 ? orange : cream);
    });
    transform.position.set(x, y + 0.185, z);
    transform.rotation.set(0, index * 0.32, 0);
    transform.scale.set(0, 0, 0);
    transform.updateMatrix();
    rims.setMatrixAt(index, transform.matrix);
    checks.setMatrixAt(index, transform.matrix);

    for (let crate = 0; crate < 2; crate++) {
      const offsetAngle = index * 0.72 + crate * Math.PI;
      const crateX = x + Math.cos(offsetAngle) * (target.radius + 0.85);
      const crateZ = z + Math.sin(offsetAngle) * (target.radius + 0.85);
      const crateHeight = 0.66 + ((index + crate) % 3) * 0.18;
      const crateGround = groundHeight(crateX, crateZ);
      transform.position.set(crateX, crateGround + crateHeight / 2, crateZ);
      transform.rotation.set(0, offsetAngle + 0.2, 0);
      transform.scale.set(0.82, crateHeight, 0.82);
      transform.updateMatrix();
      crates.setMatrixAt(index * 2 + crate, transform.matrix);
      crates.setColorAt(index * 2 + crate, crate === 0 ? orange : cream);
      transform.position.y = crateGround + crateHeight + 0.009;
      transform.scale.set(0.86, 0.026, 0.12);
      transform.updateMatrix();
      crateStraps.setMatrixAt(index * 2 + crate, transform.matrix);
    }

    const poleX = x - target.radius * 0.74;
    const poleZ = z - target.radius * 0.74;
    const poleGround = groundHeight(poleX, poleZ);
    transform.position.set(poleX, poleGround + 0.9, poleZ);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    poles.setMatrixAt(index, transform.matrix);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 144;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 256, 144);
    context.fillStyle = '#26342c';
    context.font = '600 70px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`T${index + 1}`, 128, 78);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    const material = ownMaterial(new THREE.MeshStandardMaterial({
      map: texture, color: '#e9d8b7', side: THREE.DoubleSide, roughness: 0.87,
    }));
    flagMaterials.push(material);
    const flag = new THREE.Mesh(flagGeometry, material);
    flag.position.set(poleX + 0.6, poleGround + 1.42, poleZ);
    flag.rotation.y = index * 0.12;
    flag.castShadow = true;
    group.add(flag);
  });

  const shellMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#778079', metalness: 0.72, roughness: 0.29,
  }));
  const tailMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#414a47', metalness: 0.66, roughness: 0.37, side: THREE.DoubleSide,
  }));
  const bandMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#c6a951', metalness: 0.48, roughness: 0.4,
  }));
  const shellGeometry = ownGeometry(new THREE.CylinderGeometry(0.145, 0.18, 0.72, 24));
  const noseGeometry = ownGeometry(new THREE.SphereGeometry(1, 24, 14));
  const collarGeometry = ownGeometry(new THREE.TorusGeometry(0.168, 0.012, 6, 24));
  collarGeometry.rotateX(Math.PI / 2);
  const capGeometry = ownGeometry(new THREE.CylinderGeometry(0.145, 0.145, 0.045, 24));
  const finGeometry = ownGeometry(new THREE.BufferGeometry());
  finGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0.12, 0.19, 0, 0.28, 0.38, 0, 0.26, 0.49, 0, 0.12, 0.44, 0,
  ], 3));
  finGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  finGeometry.computeVertexNormals();
  const up = new THREE.Vector3(0, 1, 0);
  const velocity = new THREE.Vector3();
  const desiredPose = new THREE.Quaternion();
  const makeBomb = () => {
    const bomb = new THREE.Group();
    bomb.name = 'Metallic game canister';
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    const nose = new THREE.Mesh(noseGeometry, shellMaterial);
    nose.scale.set(0.18, 0.22, 0.18);
    nose.position.y = -0.36;
    const cap = new THREE.Mesh(capGeometry, tailMaterial);
    cap.position.y = 0.37;
    bomb.add(shell, nose, cap);
    for (const height of [-0.2, 0.22]) {
      const collar = new THREE.Mesh(collarGeometry, bandMaterial);
      collar.position.y = height;
      bomb.add(collar);
    }
    for (let fin = 0; fin < 4; fin++) {
      const mesh = new THREE.Mesh(finGeometry, tailMaterial);
      mesh.rotation.y = fin * Math.PI / 2;
      bomb.add(mesh);
    }
    bomb.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
    bomb.userData.pose = new THREE.Quaternion();
    bomb.visible = false;
    group.add(bomb);
    return bomb;
  };
  const bombs = new Map<number, THREE.Group>();
  const bombPool: THREE.Group[] = [];

  const noiseShader = `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float cloud(vec2 p) { return noise(p) * 0.57 + noise(p * 2.07 + 13.7) * 0.28 + noise(p * 4.19) * 0.15; }
  `;
  const particleVertex = `
    attribute float effectOpacity;
    attribute float effectSeed;
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vOpacity;
    varying float vSeed;
    #include <fog_pars_vertex>
    void main() {
      vUv = uv; vColor = instanceColor; vOpacity = effectOpacity; vSeed = effectSeed;
      vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
      float angle = effectSeed * 6.2831853;
      vec2 local = position.xy * size;
      local = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * local;
      vec4 mvPosition = vec4(centre.xy + local, centre.z, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `;
  const particleFragment = `
    uniform float effectTime;
    uniform float effectKind;
    uniform float nightAmount;
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vOpacity;
    varying float vSeed;
    #include <fog_pars_fragment>
    ${noiseShader}
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float radial = 1.0 - dot(p, p);
      float n = cloud(vUv * 4.8 + vec2(vSeed * 23.0, effectTime * 0.13));
      float alpha = smoothstep(0.0, 0.68, radial + (n - 0.5) * 0.55) * vOpacity;
      vec3 tint = vColor * (0.66 + n * 0.46);
      if (effectKind < 0.5 || (effectKind > 1.5 && effectKind < 3.5)) {
        alpha *= 0.52 + n * 0.48;
        tint *= mix(1.0, 0.54, nightAmount);
        tint *= 0.8 + 0.2 * vUv.y;
      } else if (effectKind < 1.5) {
        float core = smoothstep(0.2, 0.9, radial + n * 0.23);
        tint = mix(vColor, vec3(1.6, 1.03, 0.42), core * 0.7) * (0.9 + n * 0.7);
        alpha *= smoothstep(-0.1, 0.6, radial);
      } else if (effectKind > 4.5) {
        alpha = pow(max(radial, 0.0), 2.0) * vOpacity;
        tint = vColor * 2.1;
      }
      if (alpha < 0.008) discard;
      gl_FragColor = vec4(tint, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `;
  const particleGeometry = ownGeometry(new THREE.PlaneGeometry(2, 2));
  const createParticles = (name: string, perExplosion: number, kind: number, additive = false) => {
    const capacity = MAX_ACTIVE_EXPLOSIONS * perExplosion;
    const geometry = ownGeometry(particleGeometry.clone());
    const opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    const seed = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('effectOpacity', opacity);
    geometry.setAttribute('effectSeed', seed);
    const material = ownMaterial(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        effectTime: { value: 0 }, effectKind: { value: kind }, nightAmount: { value: 0 },
      }]),
      vertexShader: particleVertex, fragmentShader: particleFragment,
      transparent: true, depthWrite: false, depthTest: true, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
    }));
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, cream);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 3 : 2;
    group.add(mesh);
    let count = 0;
    return {
      mesh, material,
      reset() { count = 0; },
      write(x: number, y: number, z: number, width: number, height: number, alpha: number, tint: THREE.Color, random: number) {
        if (count >= capacity || alpha <= 0.008) return;
        transform.position.set(x, y, z); transform.rotation.set(0, 0, 0); transform.scale.set(width, height, 1);
        transform.updateMatrix(); mesh.setMatrixAt(count, transform.matrix); mesh.setColorAt(count, tint);
        opacity.setX(count, alpha); seed.setX(count, random); count++;
      },
      finish(time: number) {
        mesh.count = count; material.uniforms.effectTime.value = time;
        if (count) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; opacity.needsUpdate = true; seed.needsUpdate = true; }
      },
    };
  };
  const smoke = createParticles('Soft rising smoke', 18, 0);
  const fire = createParticles('Short rolling fire cloud', 8, 1, true);
  const dust = createParticles('Expanding ground dust', 12, 2);
  const mist = createParticles('Water mist cloud', 14, 3);
  const spray = createParticles('Water droplets', 22, 4);
  const flash = createParticles('Brief impact flash', 1, 5, true);
  const particleFields = [smoke, fire, dust, mist, spray, flash];

  const ringGeometry = ownGeometry(new THREE.RingGeometry(0.95, 1, 80));
  ringGeometry.rotateX(-Math.PI / 2);
  const ringOpacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTIVE_EXPLOSIONS * 3), 1);
  ringGeometry.setAttribute('effectOpacity', ringOpacity);
  const ringMaterial = ownMaterial(new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { effectTime: { value: 0 } }]),
    vertexShader: `
      attribute float effectOpacity;
      varying vec2 vUv; varying vec3 vColor; varying float vOpacity;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vColor = instanceColor; vOpacity = effectOpacity;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float effectTime;
      varying vec2 vUv; varying vec3 vColor; varying float vOpacity;
      #include <fog_pars_fragment>
      ${noiseShader}
      void main() {
        float foam = 0.42 + 0.58 * cloud(vUv * 32.0 + effectTime * 0.08);
        gl_FragColor = vec4(vColor, vOpacity * foam);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  }));
  const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, MAX_ACTIVE_EXPLOSIONS * 3);
  rings.setColorAt(0, cream);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage); rings.count = 0; rings.frustumCulled = false;
  group.add(rings);
  const fragmentGeometry = ownGeometry(new THREE.IcosahedronGeometry(0.085, 0));
  const fragmentMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#59534a', roughness: 0.85, metalness: 0.12 }));
  const fragments = new THREE.InstancedMesh(fragmentGeometry, fragmentMaterial, MAX_ACTIVE_EXPLOSIONS * 16);
  fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fragments.count = 0; fragments.frustumCulled = false;
  group.add(fragments);
  // Keep the light count fixed: even idle lamps remain in the scene with zero
  // intensity, avoiding shader recompilation every time an effect appears.
  const flashLights = Array.from({ length: 3 }, () => {
    const light = new THREE.PointLight('#ffc990', 0, 40, 2);
    light.castShadow = false; group.add(light); return light;
  });
  let night = false;
  let disposed = false;
  let previousTime = 0;
  const rand = (id: number, index: number) => {
    const value = Math.sin(id * 19.731 + index * 43.117) * 41791.319;
    return value - Math.floor(value);
  };
  const smokeColor = new THREE.Color();
  const dustColor = new THREE.Color('#b19b7a');
  const waterColor = new THREE.Color('#d9f0ee');
  const flameColor = new THREE.Color('#ed752b');
  const warmWhite = new THREE.Color('#fff1cb');
  const ease = (start: number, end: number, value: number) => THREE.MathUtils.smoothstep(value, start, end);

  return {
    group,
    setNight(value: boolean) {
      night = value;
      for (const field of particleFields) field.material.uniforms.nightAmount.value = value ? 1 : 0;
      rimMaterial.emissiveIntensity = value ? 1.05 : 0.5;
      checkMaterial.emissiveIntensity = value ? 0.65 : 0.28;
    },
    update(state: WeaponState, time: number) {
      if (disposed) return;
      const delta = THREE.MathUtils.clamp(time - previousTime, 0, 0.06); previousTime = time;
      const hitIds = new Set(state.hitTargetIds);
      TARGETS.forEach((target, index) => {
        const hit = hitIds.has(target.id);
        const { x, z } = target.position;
        const y = targetHeights[index];
        if (hit !== hitStates[index]) {
          hitStates[index] = hit;
          padLayers.forEach((layer, layerIndex) => {
            color.copy(hit ? (layerIndex % 2 === 0 ? dark : lime) : (layerIndex % 2 === 0 ? orange : cream));
            layer.setColorAt(index, color); if (layer.instanceColor) layer.instanceColor.needsUpdate = true;
          });
          for (let crate = 0; crate < 2; crate++) crates.setColorAt(index * 2 + crate, hit ? dark : (crate === 0 ? orange : cream));
          if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
          flagMaterials[index].color.copy(hit ? lime : cream);
          transform.position.set(x, y + 0.19, z); transform.rotation.set(0, index * 0.32, 0);
          transform.scale.set(hit ? target.radius * 0.45 : 0, 1, hit ? target.radius * 0.45 : 0);
          transform.updateMatrix(); checks.setMatrixAt(index, transform.matrix); checks.instanceMatrix.needsUpdate = true;
        }
        transform.position.set(x, y + 0.186, z); transform.rotation.set(0, 0, 0);
        const pulse = hit ? target.radius * (1.015 + Math.sin(time * 2.4 + index) * 0.004) : 0;
        transform.scale.set(pulse, 1, pulse); transform.updateMatrix(); rims.setMatrixAt(index, transform.matrix);
      });
      rims.instanceMatrix.needsUpdate = true;

      const activeBombs = state.bombs.slice(-MAX_ACTIVE_BOMBS);
      const bombIds = new Set(activeBombs.map(bomb => bomb.id));
      for (const [id, visual] of bombs) if (!bombIds.has(id)) {
        visual.visible = false; bombs.delete(id); bombPool.push(visual);
      }
      for (const bomb of activeBombs) {
        let visual = bombs.get(bomb.id);
        let fresh = false;
        if (!visual) { visual = bombPool.pop() ?? makeBomb(); bombs.set(bomb.id, visual); fresh = true; }
        visual.visible = true; visual.position.set(bomb.position.x, bomb.position.y, bomb.position.z);
        velocity.set(-bomb.velocity.x, -bomb.velocity.y, -bomb.velocity.z);
        if (velocity.lengthSq() > 0.001) desiredPose.setFromUnitVectors(up, velocity.normalize());
        else desiredPose.identity();
        const pose = visual.userData.pose as THREE.Quaternion;
        if (fresh) pose.copy(desiredPose); else pose.slerp(desiredPose, 1 - Math.exp(-9 * delta));
        visual.quaternion.copy(pose); visual.rotateY(time * 0.65 + bomb.id * 0.81);
      }

      for (const field of particleFields) field.reset();
      let ringCount = 0; let fragmentCount = 0; let lightCount = 0;
      for (const light of flashLights) light.intensity = 0;
      const activeExplosions = state.explosions.slice(-MAX_ACTIVE_EXPLOSIONS);
      for (const explosion of activeExplosions) {
        const age = THREE.MathUtils.clamp(explosion.age, 0, EXPLOSION_LIFETIME);
        if (age >= EXPLOSION_LIFETIME) continue;
        const p = explosion.position;
        const waterImpact = isWater(p.x, p.z) && p.y <= WATER_LEVEL + 0.35;
        const lateFade = 1 - ease(2.5, EXPLOSION_LIFETIME, age);
        if (age < 0.2 && lightCount < flashLights.length) {
          const light = flashLights[lightCount++];
          light.position.set(p.x, p.y + 1.2, p.z); light.color.set(waterImpact ? '#d5edff' : '#ffc990');
          light.intensity = (night ? 340 : 100) * (1 - ease(0.025, 0.2, age)) ** 2;
        }
        if (age < 0.11) flash.write(p.x, p.y + 0.5, p.z, 1 + age * 24, 1 + age * 24,
          (1 - age / 0.11) * (waterImpact ? 0.42 : 0.9), waterImpact ? waterColor : warmWhite, 0);

        const ringDuration = waterImpact ? 2.5 : 0.7;
        if (age < ringDuration) for (let ring = 0; ring < (waterImpact ? 3 : 1); ring++) {
          const delay = ring * 0.1;
          const t = Math.max(0, age - delay);
          const radius = 0.4 + t * (waterImpact ? 5.2 - ring * 0.75 : BLAST_RADIUS / 0.7);
          transform.position.set(p.x, p.y + 0.025 + ring * 0.007, p.z); transform.rotation.set(0, 0, 0);
          transform.scale.set(radius, 1, radius); transform.updateMatrix(); rings.setMatrixAt(ringCount, transform.matrix);
          rings.setColorAt(ringCount, waterImpact ? waterColor : dustColor);
          ringOpacity.setX(ringCount, (1 - age / ringDuration) ** 1.4 * (waterImpact ? 0.72 : 0.22)); ringCount++;
        }

        if (waterImpact) {
          for (let i = 0; i < 22 && age < 1.15; i++) {
            const r = rand(explosion.id, i); const angle = i * 2.39996 + explosion.id;
            const radius = age * (2.8 + r * 7.2); const y = Math.max(0, age * (5 + r * 7) - age * age * 7.5);
            if (y <= 0.025 && age > 0.3) continue;
            spray.write(p.x + Math.cos(angle) * radius, p.y + y + 0.2, p.z + Math.sin(angle) * radius,
              0.045 + r * 0.07, 0.18 + r * 0.24, (1 - age / 1.15) * 0.78, waterColor, 0);
          }
          for (let i = 0; i < 14; i++) {
            const r = rand(explosion.id, i + 40); const angle = i * 2.39996 + explosion.id * 0.6;
            const radius = (0.2 + age * 0.7) * (1 + r); const size = 0.5 + age * (0.95 + r * 0.55);
            const alpha = ease(0.025, 0.23, age) * (1 - ease(1.5, 3, age)) * 0.24;
            mist.write(p.x + Math.cos(angle) * radius + age * 0.3, p.y + 0.5 + age * (1.1 + r * 0.45),
              p.z + Math.sin(angle) * radius, size, size * 0.8, alpha, waterColor, r);
          }
          continue;
        }

        for (let i = 0; i < 8 && age < 0.65; i++) {
          const r = rand(explosion.id, i); const angle = i * 2.39996 + explosion.id;
          const size = (0.5 + age * 5.2) * (0.68 + r * 0.6); const radius = age * (1.7 + r * 2.5);
          const alpha = ease(0, 0.03, age) * (1 - ease(0.16, 0.65, age)) * 0.64;
          fire.write(p.x + Math.cos(angle) * radius, p.y + 0.55 + age * (1.5 + r * 2.5), p.z + Math.sin(angle) * radius,
            size, size * (0.8 + r * 0.4), alpha, flameColor, r);
        }
        for (let i = 0; i < 12 && age < 1.75; i++) {
          const r = rand(explosion.id, i + 10); const angle = i * 2.39996 + explosion.id * 0.4;
          const radius = Math.sqrt(age) * (2 + r * 3.8); const size = 0.7 + age * (1.5 + r * 1.5);
          const alpha = ease(0.04, 0.2, age) * (1 - ease(0.6, 1.75, age)) * 0.23;
          dust.write(p.x + Math.cos(angle) * radius, p.y + 0.3 + age * (0.45 + r * 0.65), p.z + Math.sin(angle) * radius,
            size, size * 0.55, alpha, dustColor, r);
        }
        for (let i = 0; i < 18; i++) {
          const r = rand(explosion.id, i + 80); const angle = i * 2.39996 + explosion.id * 0.3;
          const delay = (i % 6) * 0.045; const t = Math.max(0, age - delay);
          const radius = (0.15 + t * 0.62) * (0.7 + r); const size = 0.35 + t * (1.0 + r * 0.9);
          const rise = 0.5 + t * (1.6 + r * 1.0) + Math.sin(t * 1.1 + i) * t * 0.12;
          const alpha = ease(0.09, 0.44, t) * lateFade * (0.23 + r * 0.09);
          smokeColor.set('#69685f').lerp(flameColor, (1 - ease(0.15, 0.8, age)) * 0.32);
          smoke.write(p.x + Math.cos(angle) * radius + t * 0.45, p.y + rise, p.z + Math.sin(angle) * radius + t * 0.18,
            size, size * (1 + r * 0.27), alpha, smokeColor, r);
        }
        if (age < 1.1) for (let i = 0; i < 16; i++) {
          const r = rand(explosion.id, i + 120); const angle = i * 2.39996 + explosion.id * 0.73;
          const radius = age * (3 + r * 6); const height = age * (4.2 + r * 4) - age * age * 8;
          if (height <= 0 && age > 0.1) continue;
          transform.position.set(p.x + Math.cos(angle) * radius, p.y + Math.max(0.05, height), p.z + Math.sin(angle) * radius);
          transform.rotation.set(i + age * 5, i * 0.3 + age * 7, age * 4 + r);
          const size = 0.55 + r; transform.scale.set(size, size * 0.65, size * 1.5);
          transform.updateMatrix(); fragments.setMatrixAt(fragmentCount++, transform.matrix);
        }
      }
      for (const field of particleFields) field.finish(time);
      rings.count = ringCount; ringMaterial.uniforms.effectTime.value = time;
      if (ringCount) { rings.instanceMatrix.needsUpdate = true; rings.instanceColor!.needsUpdate = true; ringOpacity.needsUpdate = true; }
      fragments.count = fragmentCount; if (fragmentCount) fragments.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      if (disposed) return; disposed = true;
      group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      for (const light of flashLights) { light.intensity = 0; light.dispose(); }
      bombs.clear(); bombPool.length = 0; group.clear(); group.removeFromParent();
    },
  };
}
