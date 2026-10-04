import * as THREE from 'three';
import { BLAST_RADIUS, EXPLOSION_LIFETIME, MAX_ACTIVE_EXPLOSIONS } from '../../src/game/weapons.ts';
import { isWater, WATER_LEVEL } from '../../src/game/landscape.ts';
import type { Explosion } from '../../src/game/weapons.ts';

export const EFFECT_COLORS = ['#69685f', '#b19b7a', '#d9f0ee', '#ed752b', '#fff1cb', '#ffc990', '#d5edff'];
export interface ReferenceField { matrices: number[]; colors: number[]; opacity: number[]; seeds: number[] }
const newField = (): ReferenceField => ({ matrices: [], colors: [], opacity: [], seeds: [] });
/** The original Three.js equations, deliberately independent of the Rust layout. */
export function explosionReference(explosions: readonly Explosion[], time: number, night = false) {
  const state = { explosions };
  const transform = new THREE.Object3D();
  const rand = (id: number, index: number) => { const value = Math.sin(id * 19.731 + index * 43.117) * 41791.319; return value - Math.floor(value); };
  const smokeColor = new THREE.Color();
  const dustColor = new THREE.Color('#b19b7a');
  const waterColor = new THREE.Color('#d9f0ee');
  const flameColor = new THREE.Color('#ed752b');
  const warmWhite = new THREE.Color('#fff1cb');
  const ease = (start: number, end: number, value: number) => THREE.MathUtils.smoothstep(value, start, end);
  const particle = (capacity: number) => {
    const result = newField();
    return {
      result,
      reset() {}, finish(_time: number) {},
      write(x: number, y: number, z: number, width: number, height: number, alpha: number, color: THREE.Color, seed: number) {
        if (result.opacity.length >= capacity || alpha <= 0.008) return;
        transform.position.set(x, y, z); transform.rotation.set(0, 0, 0); transform.scale.set(width, height, 1); transform.updateMatrix();
        result.matrices.push(...transform.matrix.elements); result.colors.push(color.r, color.g, color.b); result.opacity.push(alpha); result.seeds.push(seed);
      },
    };
  };
  const smoke = particle(18 * MAX_ACTIVE_EXPLOSIONS); const fire = particle(8 * MAX_ACTIVE_EXPLOSIONS); const dust = particle(12 * MAX_ACTIVE_EXPLOSIONS);
  const mist = particle(14 * MAX_ACTIVE_EXPLOSIONS); const spray = particle(22 * MAX_ACTIVE_EXPLOSIONS); const flash = particle(MAX_ACTIVE_EXPLOSIONS);
  const particleFields = [smoke, fire, dust, mist, spray, flash];
  const ring = newField(); const fragmentMatrices: number[] = [];
  const rings = { count: 0, setMatrixAt(_i: number, matrix: THREE.Matrix4) { ring.matrices.push(...matrix.elements); }, setColorAt(_i: number, color: THREE.Color) { ring.colors.push(color.r, color.g, color.b); }, instanceMatrix: { needsUpdate: false }, instanceColor: { needsUpdate: false } };
  const ringOpacity = { setX(_i: number, alpha: number) { ring.opacity.push(alpha); }, needsUpdate: false };
  const ringMaterial = { uniforms: { effectTime: { value: 0 } } };
  const fragments = { count: 0, setMatrixAt(_i: number, matrix: THREE.Matrix4) { fragmentMatrices.push(...matrix.elements); }, instanceMatrix: { needsUpdate: false } };
  const flashLights = Array.from({ length: 3 }, () => ({ intensity: 0, position: new THREE.Vector3(), color: new THREE.Color() }));
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
  return { fields: particleFields.map(field => field.result), ring, fragments: fragmentMatrices,
    lights: flashLights.filter(light => light.intensity > 0).flatMap(light => [light.position.x, light.position.y, light.position.z, light.color.r, light.color.g, light.color.b, light.intensity]) };
}
