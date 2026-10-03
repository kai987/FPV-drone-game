import * as THREE from 'three';
import { groundHeight, LAKES, RIVER_SAMPLES, TERRAIN_SIZE, WATER_LEVEL, WORLD_CENTER_Z } from './landscape.ts';

/** Seamless slope texture: integer frequencies wrap exactly, and mipmaps filter tiny ripples. */
function createRippleTexture() {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 821;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const waves = Array.from({ length: 48 }, (_, i) => {
    const frequency = 8 + random() * 48;
    // A preferred wind direction gives short, uneven crests instead of round noise blobs.
    const x = Math.round(frequency);
    const z = Math.round((random() - 0.5) * 20);
    const length = Math.hypot(x, z) || 1;
    return { x, z, phase: random() * Math.PI * 2, weight: (0.55 + random() * 0.45) / Math.sqrt(i + 6), length };
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let slopeX = 0;
      let slopeZ = 0;
      let height = 0;
      for (const wave of waves) {
        const phase = (x * wave.x + y * wave.z) / size * Math.PI * 2 + wave.phase;
        const slope = Math.cos(phase) * wave.weight;
        slopeX += slope * wave.x / wave.length;
        slopeZ += slope * wave.z / wave.length;
        height += Math.sin(phase) * wave.weight;
      }
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(127.5 + THREE.MathUtils.clamp(slopeX * 0.3, -1, 1) * 127.5);
      pixels[offset + 1] = Math.round(127.5 + THREE.MathUtils.clamp(slopeZ * 0.3, -1, 1) * 127.5);
      pixels[offset + 2] = Math.round(127.5 + THREE.MathUtils.clamp(height * 0.3, -1, 1) * 127.5);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Compute the current once per vertex; the fragment shader never searches the river. */
function currentAt(x: number, z: number) {
  let distanceSquared = Infinity;
  let directionX = 0;
  let directionZ = 1;
  for (let i = 0; i < RIVER_SAMPLES.length - 1; i++) {
    const a = RIVER_SAMPLES[i];
    const b = RIVER_SAMPLES[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSquared, 0, 1);
    const distance = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
    if (distance < distanceSquared) {
      distanceSquared = distance;
      directionX = dx / Math.sqrt(lengthSquared);
      directionZ = dz / Math.sqrt(lengthSquared);
    }
  }
  let strength = 1 - THREE.MathUtils.smoothstep(Math.sqrt(distanceSquared), 22, 80);
  for (const lake of LAKES) {
    const dx = x - lake.x;
    const dz = z - lake.z;
    const u = (dx * Math.cos(lake.rotation) + dz * Math.sin(lake.rotation)) / lake.radiusX;
    const v = (-dx * Math.sin(lake.rotation) + dz * Math.cos(lake.rotation)) / lake.radiusZ;
    strength *= THREE.MathUtils.smoothstep(Math.hypot(u, v), 0.72, 1.12);
  }
  return [directionX * strength, directionZ * strength, strength];
}

/** A level collision surface with animated, filtered optical waves above its carved bed. */
export function createWater(panorama: THREE.Texture) {
  const group = new THREE.Group();
  group.name = 'Lakes and flowing river';
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 300, 300);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const depths = new Float32Array(positions.count);
  const currents = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i) + WORLD_CENTER_Z;
    depths[i] = WATER_LEVEL - groundHeight(x, z);
    // Dry vertices are hidden by terrain; keep a margin for shoreline interpolation.
    if (depths[i] > -6) currents.set(currentAt(x, z), i * 3);
  }
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(depths, 1));
  geometry.setAttribute('waterCurrent', new THREE.BufferAttribute(currents, 3));
  const ripples = createRippleTexture();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      night: { value: 0 },
      rippleMap: { value: ripples },
      panorama: { value: panorama },
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
        float rotation = PI * 0.5 + 0.13;
        vec3 localRay = normalize(vec3(
          cos(rotation) * ray.x - sin(rotation) * ray.z,
          max(ray.y, 0.015) / 0.72,
          sin(rotation) * ray.x + cos(rotation) * ray.z));
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
        water = mix(water, reflection * mix(vec3(0.70), vec3(0.07, 0.12, 0.20), night), 0.08 + fresnel * 0.78);

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
        float alpha = mix(0.58, 0.86, smoothstep(0.0, 5.0, waterDepth));
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
