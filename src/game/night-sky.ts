import * as THREE from 'three';
import { WORLD_CENTER_Z } from './landscape.ts';

export function createNightSky() {
  const group = new THREE.Group();
  group.name = 'Moon and stars';
  group.position.z = WORLD_CENTER_Z;
  let seed = 93473;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = new Float32Array(1400 * 3);
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < 1400; i++) {
    // Keep stars above the mountain silhouettes baked into the distant panorama.
    const y = 0.55 + random() * 0.45;
    const azimuth = random() * Math.PI * 2;
    const radius = Math.sqrt(1 - y * y);
    positions.set([Math.cos(azimuth) * radius * 4600, y * 3400, Math.sin(azimuth) * radius * 4600], i * 3);
    const brightness = 0.4 + random() * 0.6;
    colors.set([brightness * 0.82, brightness * 0.9, brightness], i * 3);
  }
  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const starsMaterial = new THREE.PointsMaterial({ size: 1.65, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.88, depthWrite: false, fog: false, toneMapped: false });
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  group.add(stars);
  const moonGeometry = new THREE.SphereGeometry(78, 32, 20);
  const moonMaterial = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 moonPoint; void main() { moonPoint = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 moonPoint; void main() {
      vec3 p = normalize(moonPoint);
      float maria = sin(p.x * 12.0 + sin(p.y * 9.0)) * sin(p.y * 16.0 + p.z * 9.0);
      float grain = sin(p.x * 65.0) * sin(p.z * 72.0 + p.y * 31.0);
      float light = 0.84 + maria * 0.1 + grain * 0.035;
      gl_FragColor = vec4(vec3(0.77, 0.85, 0.95) * light, 1.0);
      #include <colorspace_fragment>
    }`,
    fog: false, toneMapped: false,
  });
  const moon = new THREE.Mesh(moonGeometry, moonMaterial);
  moon.position.set(-1750, 2100, -3200);
  group.add(moon);
  group.visible = false;
  return {
    group,
    setNight(enabled: boolean) { group.visible = enabled; },
    dispose() { starsGeometry.dispose(); starsMaterial.dispose(); moonGeometry.dispose(); moonMaterial.dispose(); group.clear(); group.removeFromParent(); },
  };
}
