import * as THREE from 'three';
import { GUN_MAX_SHOTS, GUN_MAX_IMPACTS, GUN_SHOT_LIFETIME, GUN_IMPACT_LIFETIME, type GunState } from './gun.ts';
import type { Vec3 } from './flight.ts';

const BULLET_LIMIT = GUN_MAX_SHOTS;
const IMPACT_LIMIT = GUN_MAX_IMPACTS;

function createBulletTexture() {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(255 * (1 - THREE.MathUtils.smoothstep(radius, 0.35, 1)));
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Pooled, purely visual arcade effects. Rust owns hit positions and lifetimes. */
export function createGunVisuals() {
  const group = new THREE.Group();
  group.name = 'Guardian bullet and impact effects';
  const bulletPositions = new Float32Array(BULLET_LIMIT * 3);
  const bulletColors = new Float32Array(BULLET_LIMIT * 3);
  const bulletGeometry = new THREE.BufferGeometry();
  bulletGeometry.setAttribute('position', new THREE.BufferAttribute(bulletPositions, 3).setUsage(THREE.DynamicDrawUsage));
  bulletGeometry.setAttribute('color', new THREE.BufferAttribute(bulletColors, 3).setUsage(THREE.DynamicDrawUsage));
  const bulletTexture = createBulletTexture();
  const bulletMaterial = new THREE.PointsMaterial({ map: bulletTexture, size: 7, sizeAttenuation: false,
    vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    toneMapped: false, blending: THREE.AdditiveBlending });
  const bullets = new THREE.Points(bulletGeometry, bulletMaterial);
  bullets.name = 'Guardian round bullet points';
  bullets.frustumCulled = false;
  group.add(bullets);
  const impactGeometry = new THREE.IcosahedronGeometry(1, 0);
  const impactMaterial = new THREE.MeshBasicMaterial({ vertexColors: false, transparent: true,
    opacity: 0.85, depthWrite: false, toneMapped: false });
  const impacts = new THREE.InstancedMesh(impactGeometry, impactMaterial, IMPACT_LIMIT);
  impacts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  impacts.frustumCulled = false;
  group.add(impacts);
  const flashGeometry = new THREE.ConeGeometry(0.15, 0.6, 6);
  flashGeometry.rotateX(-Math.PI / 2);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: '#fff3ad', transparent: true,
    opacity: 0.95, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  flash.name = 'Guardian muzzle flash';
  flash.frustumCulled = false;
  group.add(flash);
  const transform = new THREE.Object3D();
  const direction = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const color = new THREE.Color();
  const launches = new Map<number, { position: Vec3; age: number }>();
  let disposed = false;
  bulletGeometry.setDrawRange(0, 0); impacts.count = 0; flash.visible = false;
  return {
    group,
    update(state: GunState, muzzle?: Vec3) {
      if (disposed) return;
      const shots = state.shots.slice(-BULLET_LIMIT);
      for (const id of launches.keys()) {
        if (!shots.some(shot => shot.id === id)) launches.delete(id);
      }
      for (let index = 0; index < shots.length; index++) {
        const shot = shots[index];
        const firstFrame = !launches.has(shot.id);
        if (firstFrame) {
          // Anchor the first visible frame to the rendered underslung muzzle.
          // Keep that launch position fixed after the aircraft moves away.
          launches.set(shot.id, { position: { ...(muzzle ?? shot.from) }, age: shot.age });
        }
        const launch = launches.get(shot.id)!;
        const origin = launch.position;
        const phase = THREE.MathUtils.clamp((shot.age - launch.age) / Math.max(0.001, GUN_SHOT_LIFETIME - launch.age), 0, 1);
        // Ease the visual travel near the gun so a frame cannot skip the launch.
        // Hit detection remains owned by Rust and independent of this animation.
        const progress = phase * phase;
        bulletPositions[index * 3] = THREE.MathUtils.lerp(origin.x, shot.to.x, progress);
        bulletPositions[index * 3 + 1] = THREE.MathUtils.lerp(origin.y, shot.to.y, progress);
        bulletPositions[index * 3 + 2] = THREE.MathUtils.lerp(origin.z, shot.to.z, progress);
        const fade = 1 - THREE.MathUtils.smoothstep(phase, 0.7, 1);
        color.setRGB(fade, fade * 0.85, fade * 0.45);
        bulletColors.set([color.r, color.g, color.b], index * 3);
      }
      bulletGeometry.setDrawRange(0, shots.length);
      bulletGeometry.attributes.position.needsUpdate = true;
      bulletGeometry.attributes.color.needsUpdate = true;
      const bursts = state.impacts.slice(-IMPACT_LIMIT);
      impacts.count = bursts.length;
      for (let index = 0; index < bursts.length; index++) {
        const burst = bursts[index];
        const life = Math.max(0, 1 - burst.age / GUN_IMPACT_LIFETIME);
        transform.position.set(burst.position.x, burst.position.y + 0.06, burst.position.z);
        transform.rotation.set(burst.id * 0.8, burst.age * 15, burst.id);
        transform.scale.setScalar((0.12 + burst.age * 1.8) * life);
        transform.updateMatrix(); impacts.setMatrixAt(index, transform.matrix);
        color.set(burst.hit ? '#d6f66b' : '#f9b959').multiplyScalar(life);
        impacts.setColorAt(index, color);
      }
      impacts.instanceMatrix.needsUpdate = true;
      if (impacts.instanceColor) impacts.instanceColor.needsUpdate = true;
      const shot = shots.at(-1);
      flash.visible = Boolean(shot && shot.age < 0.055);
      if (shot && flash.visible) {
        const origin = muzzle ?? shot.from;
        direction.set(shot.to.x - origin.x, shot.to.y - origin.y, shot.to.z - origin.z).normalize();
        flash.position.set(origin.x, origin.y, origin.z).addScaledVector(direction, 0.23);
        flash.quaternion.setFromUnitVectors(forward, direction);
        flash.scale.setScalar(0.7 + (shot.id % 3) * 0.18);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      bulletGeometry.dispose(); bulletMaterial.dispose(); bulletTexture.dispose(); impactGeometry.dispose(); impactMaterial.dispose();
      flashGeometry.dispose(); flashMaterial.dispose();
      impacts.dispose(); launches.clear(); group.clear(); group.removeFromParent();
    },
  };
}
