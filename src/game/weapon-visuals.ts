import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BLAST_RADIUS, EXPLOSION_LIFETIME, MAX_ACTIVE_BOMBS, MAX_ACTIVE_EXPLOSIONS, TARGETS,
} from './weapons';
import type { WeaponState } from './weapons';
import { groundHeight } from './world';

interface ExplosionVisual {
  group: THREE.Group;
  flash: THREE.Mesh;
  wave: THREE.Mesh;
  fragments: THREE.InstancedMesh;
  smoke: THREE.InstancedMesh;
  flashMaterial: THREE.MeshBasicMaterial;
  waveMaterial: THREE.MeshBasicMaterial;
  fragmentMaterial: THREE.MeshStandardMaterial;
  smokeMaterial: THREE.MeshBasicMaterial;
}

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
  const orangeMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#e88539', roughness: 0.54, metalness: 0.13 }));
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

  const canisterGeometry = ownGeometry(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 14));
  const capGeometry = ownGeometry(new THREE.CylinderGeometry(0.162, 0.162, 0.065, 14));
  const noseGeometry = ownGeometry(new THREE.SphereGeometry(1, 14, 8));
  const bombRimGeometry = ownGeometry(new THREE.TorusGeometry(0.154, 0.012, 5, 14));
  bombRimGeometry.rotateX(Math.PI / 2);
  const up = new THREE.Vector3(0, 1, 0);
  const velocity = new THREE.Vector3();

  const makeBomb = () => {
    const bomb = new THREE.Group();
    const shell = new THREE.Mesh(canisterGeometry, creamMaterial);
    shell.castShadow = true;
    const cap = new THREE.Mesh(capGeometry, orangeMaterial);
    cap.position.y = 0.238;
    cap.castShadow = true;
    const nose = new THREE.Mesh(noseGeometry, orangeMaterial);
    nose.scale.set(0.15, 0.135, 0.15);
    nose.position.y = -0.247;
    nose.castShadow = true;
    const band = new THREE.Mesh(bombRimGeometry, orangeMaterial);
    band.position.y = -0.08;
    const fins = new THREE.InstancedMesh(unitBox, orangeMaterial, 4);
    fins.castShadow = true;
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      transform.position.set(Math.cos(angle) * 0.179, 0.174, Math.sin(angle) * 0.179);
      transform.rotation.set(0, -angle, 0);
      transform.scale.set(0.13, 0.16, 0.022);
      transform.updateMatrix();
      fins.setMatrixAt(i, transform.matrix);
    }
    bomb.add(shell, cap, nose, band, fins);
    bomb.visible = false;
    group.add(bomb);
    return bomb;
  };
  const bombs = new Map<number, THREE.Group>();
  const bombPool: THREE.Group[] = [];

  const flashGeometry = ownGeometry(new THREE.SphereGeometry(1, 16, 10));
  const waveGeometry = ownGeometry(new THREE.RingGeometry(0.945, 1, 56));
  waveGeometry.rotateX(-Math.PI / 2);
  const smokeGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const fragmentGeometry = ownGeometry(new THREE.IcosahedronGeometry(0.105, 0));
  const makeExplosion = (): ExplosionVisual => {
    const effect = new THREE.Group();
    const flashMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#ffe6a6', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false,
    }));
    const waveMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#ffc76d', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    const fragmentMaterial = ownMaterial(new THREE.MeshStandardMaterial({
      color: '#eb963e', roughness: 0.8, transparent: true, opacity: 1, depthWrite: false,
    }));
    const smokeMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#8e8572', transparent: true, opacity: 0.25, depthWrite: false,
    }));
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    const wave = new THREE.Mesh(waveGeometry, waveMaterial);
    const fragments = new THREE.InstancedMesh(fragmentGeometry, fragmentMaterial, 9);
    const smoke = new THREE.InstancedMesh(smokeGeometry, smokeMaterial, 5);
    // Their local bounds expand throughout the short effect; avoid stale
    // instanced bounds clipping particles at the edge of the camera view.
    fragments.frustumCulled = false;
    smoke.frustumCulled = false;
    flash.position.y = 0.6;
    wave.position.y = 0.15;
    effect.add(flash, wave, fragments, smoke);
    effect.visible = false;
    group.add(effect);
    return { group: effect, flash, wave, fragments, smoke, flashMaterial, waveMaterial, fragmentMaterial, smokeMaterial };
  };
  const explosions = new Map<number, ExplosionVisual>();
  const explosionPool: ExplosionVisual[] = [];
  let disposed = false;

  return {
    group,
    update(state: WeaponState, time: number) {
      if (disposed) return;
      const hitIds = new Set(state.hitTargetIds);
      TARGETS.forEach((target, index) => {
        const hit = hitIds.has(target.id);
        const { x, z } = target.position;
        const y = targetHeights[index];
        if (hit !== hitStates[index]) {
          hitStates[index] = hit;
          padLayers.forEach((layer, layerIndex) => {
            color.copy(hit ? (layerIndex % 2 === 0 ? dark : lime) : (layerIndex % 2 === 0 ? orange : cream));
            layer.setColorAt(index, color);
            if (layer.instanceColor) layer.instanceColor.needsUpdate = true;
          });
          for (let crate = 0; crate < 2; crate++) crates.setColorAt(index * 2 + crate, hit ? dark : (crate === 0 ? orange : cream));
          if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
          flagMaterials[index].color.copy(hit ? lime : cream);
          transform.position.set(x, y + 0.19, z);
          transform.rotation.set(0, index * 0.32, 0);
          transform.scale.set(hit ? target.radius * 0.45 : 0, 1, hit ? target.radius * 0.45 : 0);
          transform.updateMatrix();
          checks.setMatrixAt(index, transform.matrix);
          checks.instanceMatrix.needsUpdate = true;
        }
        transform.position.set(x, y + 0.186, z);
        transform.rotation.set(0, 0, 0);
        const pulse = hit ? target.radius * (1.015 + Math.sin(time * 2.4 + index) * 0.004) : 0;
        transform.scale.set(pulse, 1, pulse);
        transform.updateMatrix();
        rims.setMatrixAt(index, transform.matrix);
      });
      rims.instanceMatrix.needsUpdate = true;

      const activeBombs = state.bombs.slice(-MAX_ACTIVE_BOMBS);
      const bombIds = new Set(activeBombs.map(bomb => bomb.id));
      for (const [id, visual] of bombs) {
        if (!bombIds.has(id)) {
          visual.visible = false;
          bombs.delete(id);
          bombPool.push(visual);
        }
      }
      for (const bomb of activeBombs) {
        let visual = bombs.get(bomb.id);
        if (!visual) {
          visual = bombPool.pop() ?? makeBomb();
          bombs.set(bomb.id, visual);
        }
        visual.visible = true;
        visual.position.set(bomb.position.x, bomb.position.y, bomb.position.z);
        velocity.set(-bomb.velocity.x, -bomb.velocity.y, -bomb.velocity.z);
        if (velocity.lengthSq() > 0.001) visual.quaternion.setFromUnitVectors(up, velocity.normalize());
        else visual.quaternion.identity();
        visual.rotateY(time * 2.1 + bomb.id * 0.48);
      }

      const activeExplosions = state.explosions.slice(-MAX_ACTIVE_EXPLOSIONS);
      const explosionIds = new Set(activeExplosions.map(explosion => explosion.id));
      for (const [id, visual] of explosions) {
        if (!explosionIds.has(id)) {
          visual.group.visible = false;
          explosions.delete(id);
          explosionPool.push(visual);
        }
      }
      for (const explosion of activeExplosions) {
        let visual = explosions.get(explosion.id);
        if (!visual) {
          visual = explosionPool.pop() ?? makeExplosion();
          explosions.set(explosion.id, visual);
        }
        const age = THREE.MathUtils.clamp(explosion.age, 0, EXPLOSION_LIFETIME);
        const progress = age / EXPLOSION_LIFETIME;
        visual.group.visible = progress < 1;
        visual.group.position.set(explosion.position.x, Math.max(explosion.position.y, groundHeight(explosion.position.x, explosion.position.z)) + 0.06, explosion.position.z);
        const flashProgress = THREE.MathUtils.clamp(age / 0.2, 0, 1);
        visual.flash.visible = flashProgress < 1;
        visual.flash.scale.setScalar(0.45 + flashProgress * 2.8);
        visual.flashMaterial.opacity = (1 - flashProgress) * 0.86;
        const waveRadius = 0.5 + Math.sqrt(progress) * BLAST_RADIUS;
        visual.wave.scale.set(waveRadius, 1, waveRadius);
        visual.waveMaterial.opacity = Math.pow(1 - progress, 1.2) * 0.7;
        visual.fragmentMaterial.opacity = Math.max(0, 1 - progress * 1.25);
        visual.smokeMaterial.opacity = Math.sin(progress * Math.PI) * 0.21;
        visual.smokeMaterial.color.set(explosion.hitCount > 0 ? '#958a6d' : '#8e8572');

        for (let i = 0; i < 9; i++) {
          const angle = i * Math.PI * 2 / 9 + explosion.id * 0.71;
          const radius = age * (3.3 + (i % 3) * 1.45);
          const height = Math.max(0.03, age * (4.8 + (i % 4) * 0.3) - age * age * 6.2);
          transform.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
          transform.rotation.set(age * 5 + i, age * 3.8 - i, age * 6.1 + i * 0.3);
          transform.scale.set(0.65 + (i % 3) * 0.2, 1, 0.75);
          transform.updateMatrix();
          visual.fragments.setMatrixAt(i, transform.matrix);
        }
        visual.fragments.instanceMatrix.needsUpdate = true;
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 2 / 5 + explosion.id;
          const radius = age * (0.95 + i * 0.14);
          const size = 0.24 + age * (0.74 + i * 0.09);
          transform.position.set(Math.cos(angle) * radius, 0.5 + age * (2.1 + i * 0.23), Math.sin(angle) * radius);
          transform.rotation.set(i + age * 0.3, i * 0.7, age * 0.5);
          transform.scale.set(size, size * 1.13, size);
          transform.updateMatrix();
          visual.smoke.setMatrixAt(i, transform.matrix);
        }
        visual.smoke.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.traverse(object => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      bombs.clear();
      bombPool.length = 0;
      explosions.clear();
      explosionPool.length = 0;
      group.clear();
      group.removeFromParent();
    },
  };
}
