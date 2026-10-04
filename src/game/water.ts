import * as THREE from 'three';
import { TERRAIN_SIZE, WATER_LEVEL, WORLD_CENTER_Z } from './landscape.ts';
import type { SceneSimulation } from './scene-simulation.ts';

/** Seamless slope texture: integer frequencies wrap exactly, and mipmaps filter tiny ripples. */
function createRippleTexture(scene: SceneSimulation) {
  const size = 256;
  const pixels = scene.ripplePixels(size);
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** A level collision surface with animated, filtered optical waves above its carved bed. */
export function createWater(panorama: THREE.Texture, scene: SceneSimulation, points: Float32Array, heights: Float32Array, panoramaRotation: number) {
  const group = new THREE.Group();
  group.name = 'Lakes and flowing river';
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 300, 300);
  geometry.rotateX(-Math.PI / 2);
  const { depths, currents } = scene.waterData(points, heights);
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(depths, 1));
  geometry.setAttribute('waterCurrent', new THREE.BufferAttribute(currents, 3));
  const ripples = createRippleTexture(scene);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      night: { value: 0 },
      rippleMap: { value: ripples },
      panorama: { value: panorama },
      panoramaRotation: { value: panoramaRotation },
      deepColor: { value: new THREE.Color('#123e49') },
      shallowColor: { value: new THREE.Color('#447b69') },
      skyColor: { value: new THREE.Color('#b0c9d5') },
    },
    vertexShader: `
      attribute float waterDepth;
      attribute vec3 waterCurrent;
      varying vec3 worldPoint;
      varying float depth;
      varying vec3 current;
      void main() {
        worldPoint = (modelMatrix * vec4(position, 1.0)).xyz;
        depth = waterDepth;
        current = waterCurrent;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float night;
      uniform sampler2D rippleMap;
      uniform sampler2D panorama;
      uniform float panoramaRotation;
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      uniform vec3 skyColor;
      varying vec3 worldPoint;
      varying float depth;
      varying vec3 current;
      const float PI = 3.14159265359;
      const mat2 ROTATE = mat2(0.8, -0.6, 0.6, 0.8);

      vec3 ripple(vec2 point, float scale, vec2 velocity) {
        // Two overlapping phases reset the advection before curved currents can stretch UVs.
        float phaseA = fract(time * 0.075);
        float phaseB = fract(time * 0.075 + 0.5);
        float blend = abs(phaseA * 2.0 - 1.0);
        vec2 uv = point * scale;
        vec3 a = texture2D(rippleMap, uv - velocity * (phaseA / 0.075) * scale).rgb;
        vec3 b = texture2D(rippleMap, uv - velocity * (phaseB / 0.075) * scale).rgb;
        return (mix(a, b, blend) * 2.0 - 1.0);
      }

      vec3 reflectedSky(vec3 ray) {
        // Match the existing sky dome's rotation and vertical scale.
        vec3 localRay = normalize(vec3(
          cos(panoramaRotation) * ray.x - sin(panoramaRotation) * ray.z,
          max(ray.y, 0.015) / 0.72,
          sin(panoramaRotation) * ray.x + cos(panoramaRotation) * ray.z));
        vec2 uv = vec2(fract(atan(localRay.z, -localRay.x) / (2.0 * PI)),
          0.5 + asin(localRay.y) / PI);
        return texture2D(panorama, uv).rgb;
      }

      void main() {
        vec2 point = worldPoint.xz;
        float distanceToCamera = length(cameraPosition - worldPoint);
        float waterDepth = max(0.0, depth);
        float river = clamp(current.z, 0.0, 1.0);
        vec2 velocity = vec2(0.28, 0.13) + current.xy * 1.35;
        // Broad wind wrinkles remain visible from the air; fine capillary ripples fade smoothly.
        vec3 broad = ripple(point, 0.006, velocity * 0.72);
        vec3 medium = ripple(ROTATE * point + 71.0, 0.028, ROTATE * velocity);
        vec3 fine = ripple(point - 39.0, 0.10, velocity * 1.2);
        float pixelFootprint = max(length(dFdx(point)), length(dFdy(point)));
        float mediumVisible = 1.0 - smoothstep(0.4, 2.0, pixelFootprint);
        float fineVisible = 1.0 - smoothstep(0.08, 0.5, pixelFootprint);
        vec2 slope = broad.xy * 0.085 + (medium.xy * ROTATE) * 0.24 * mediumVisible
          + fine.xy * 0.14 * fineVisible;
        slope *= mix(0.68, 1.0, smoothstep(0.05, 1.8, waterDepth));
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 viewDirection = normalize(cameraPosition - worldPoint);
        float fresnel = 0.025 + 0.975 * pow(1.0 - max(dot(viewDirection, normal), 0.0), 5.0);
        vec3 reflection = reflectedSky(reflect(-viewDirection, normal));
        vec3 water = mix(shallowColor, deepColor, 1.0 - exp(-waterDepth * 0.34));
        // Subtle moving light bands over a shallow bed, never bright foam across deep lakes.
        float caustic = pow(max(0.0, 1.0 - abs(medium.b + fine.b * 0.35) * 3.5), 3.0);
        water += vec3(0.026, 0.042, 0.023) * (1.0 - night * 0.8) * caustic * exp(-waterDepth * 1.4) * mediumVisible;
        water *= 0.94 + broad.b * 0.16 + medium.b * 0.095 * mediumVisible;
        water = mix(water, reflection * mix(vec3(0.70), vec3(0.07, 0.12, 0.20), night), 0.045 + fresnel * 0.78);

        vec3 lightDirection = normalize(mix(vec3(-180.0, 282.0, 180.0), vec3(-180.0, 222.0, -330.0), night));
        vec3 halfwayDirection = normalize(viewDirection + lightDirection);
        float specular = pow(max(dot(normal, halfwayDirection), 0.0), mix(360.0, 100.0, smoothstep(0.3, 2.0, pixelFootprint)));
        // A low energy glint preserves individual highlights without washing the water white.
        water += mix(vec3(1.0, 0.91, 0.72), vec3(0.38, 0.57, 0.88), night) * specular * 0.32;
        float crest = smoothstep(0.24, 0.67, medium.b + broad.b * 0.3);
        water += vec3(0.09, 0.13, 0.12) * (1.0 - night * 0.7) * crest * mediumVisible * (0.4 + river * 0.3);
        float shore = (1.0 - smoothstep(0.08, 0.85, waterDepth)) * smoothstep(0.0, 0.055, waterDepth);
        float wash = sin(waterDepth * 14.0 - time * 1.1 + broad.b * 3.0);
        float foam = smoothstep(0.45, 0.85, wash) * smoothstep(-0.12, 0.5, medium.b);
        water = mix(water, vec3(0.60, 0.70, 0.61), shore * foam * 0.26 * mediumVisible);
        float fog = 1.0 - exp(-pow(distanceToCamera * mix(0.00022, 0.00030, night), 2.0));
        // Clip the tiny depth-offset overlap with dry banks after derivative-based sampling.
        if (depth <= 0.0) discard;
        // Clear shallows let a shoal just under the surface remain readable from a low flight.
        // At grazing angles Fresnel reflection still conceals underwater detail naturally.
        float alpha = mix(0.32, 0.72, smoothstep(0.0, 7.0, waterDepth));
        alpha = mix(alpha, 0.98, fresnel);
        gl_FragColor = vec4(mix(water, skyColor, fog), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  material.transparent = true;
  material.depthWrite = false;
  const surface = new THREE.Mesh(geometry, material);
  surface.position.set(0, WATER_LEVEL + 0.025, WORLD_CENTER_Z);
  group.add(surface);
  return {
    group,
    setNight(enabled: boolean) {
      material.uniforms.night.value = enabled ? 1 : 0;
      material.uniforms.deepColor.value.set(enabled ? '#071c30' : '#123e49');
      material.uniforms.shallowColor.value.set(enabled ? '#183c4a' : '#447b69');
      material.uniforms.skyColor.value.set(enabled ? '#101e32' : '#b0c9d5');
    },
    update(time: number) { material.uniforms.time.value = time; },
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
      ripples.dispose();
      // The shared sky panorama is owned and disposed by the world.
      group.clear();
    },
  };
}
