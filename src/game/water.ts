import * as THREE from 'three';
import { groundHeight, TERRAIN_SIZE, WATER_LEVEL, WORLD_CENTER_Z } from './landscape.ts';

/** A continuous level surface, revealed by the carved lake and river beds. */
export function createWater() {
  const group = new THREE.Group();
  group.name = 'Lakes and flowing river';
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 300, 300);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const depths = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    depths[i] = WATER_LEVEL - groundHeight(positions.getX(i), positions.getZ(i) + WORLD_CENTER_Z);
  }
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(depths, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      deepColor: { value: new THREE.Color('#184d59') },
      shallowColor: { value: new THREE.Color('#4d9184') },
      skyColor: { value: new THREE.Color('#b0c9d5') },
    },
    vertexShader: `
      attribute float waterDepth;
      varying vec3 worldPoint;
      varying float depth;
      void main() {
        worldPoint = (modelMatrix * vec4(position, 1.0)).xyz;
        depth = waterDepth;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      uniform vec3 skyColor;
      varying vec3 worldPoint;
      varying float depth;
      void main() {
        float p = dot(worldPoint.xz, vec2(0.68, 0.41)) + sin(worldPoint.z * 0.047) * 2.1 + time * 0.92;
        float q = dot(worldPoint.xz, vec2(-0.22, 0.37)) + sin(worldPoint.x * 0.063) * 1.7 - time * 0.63;
        float swell = sin(dot(worldPoint.xz, vec2(0.032, 0.024)) + time * 0.23);
        float distanceToCamera = length(cameraPosition - worldPoint);
        float rippleStrength = 1.0 / (1.0 + distanceToCamera * 0.006);
        vec3 normal = normalize(vec3((sin(p) * 0.06 + sin(q) * 0.045) * rippleStrength,
          1.0, (cos(p) * 0.045 + cos(q) * 0.065) * rippleStrength));
        vec3 viewDirection = normalize(cameraPosition - worldPoint);
        vec3 reflected = reflect(-viewDirection, normal);
        float fresnel = pow(1.0 - max(dot(viewDirection, normal), 0.0), 3.5);
        float waterDepth = max(0.0, depth);
        vec3 water = mix(shallowColor, deepColor, smoothstep(0.0, 4.5, waterDepth));
        water *= 0.97 + swell * 0.028;
        float clouds = smoothstep(0.36, 0.9,
          sin(reflected.x * 9.0 + reflected.z * 6.0) * 0.34
          + sin(reflected.x * 19.0 - reflected.z * 12.0) * 0.18 + 0.38);
        vec3 reflection = mix(skyColor * 0.35, vec3(0.36, 0.43, 0.41), clouds * 0.2);
        water = mix(water, reflection, 0.1 + fresnel * 0.38);
        vec3 lightDirection = normalize(vec3(-0.55, 0.83, 0.28));
        vec3 halfwayDirection = normalize(viewDirection + lightDirection);
        vec3 reflectionNormal = normalize(vec3(normal.x * 0.15, 1.0, normal.z * 0.15));
        float glint = pow(max(dot(reflectionNormal, halfwayDirection), 0.0), 120.0);
        water += vec3(1.0, 0.93, 0.75) * glint * 0.3;
        float shore = (1.0 - smoothstep(0.12, 1.1, waterDepth)) * smoothstep(0.0, 0.15, waterDepth);
        water = mix(water, vec3(0.72, 0.81, 0.7), shore * (0.12 + sin(q) * 0.055));
        float fog = 1.0 - exp(-pow(distanceToCamera * 0.00022, 2.0));
        gl_FragColor = vec4(mix(water, skyColor, fog), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.position.set(0, WATER_LEVEL + 0.025, WORLD_CENTER_Z);
  group.add(surface);
  return {
    group,
    update(time: number) { material.uniforms.time.value = time; },
    dispose() { group.removeFromParent(); geometry.dispose(); material.dispose(); group.clear(); },
  };
}
