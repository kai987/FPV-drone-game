import * as THREE from 'three';

export interface AlpineTerrainTextures {
  grassTexture: THREE.Texture;
  rockTexture: THREE.Texture;
  snowTexture: THREE.Texture;
}

// All coordinates are in metres. Terrain vertices and normals are authored in
// world space, so cliffs keep the same material scale as horizontal ledges.
const ALPINE_FIELD_GLSL = /* glsl */ `
  float alpineHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float alpineNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(alpineHash(i), alpineHash(i + vec2(1.0, 0.0)), f.x),
      mix(alpineHash(i + vec2(0.0, 1.0)), alpineHash(i + vec2(1.0)), f.x), f.y);
  }
  float alpineFbm(vec2 p) {
    return alpineNoise(p) * 0.57 + alpineNoise(p * 2.13 + 18.7) * 0.28
      + alpineNoise(p * 4.31 - 7.3) * 0.15;
  }
  vec3 alpineTriplanar(sampler2D image, vec3 p, vec3 weights) {
    return texture2D(image, p.zy).rgb * weights.x
      + texture2D(image, p.xz).rgb * weights.y
      + texture2D(image, p.xy).rgb * weights.z;
  }
  float alpineLuminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec2 alpineJointHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }
  // Metre-scale stone joints stay visible when the fine generated image is mipmapped.
  // Warped irregular cells give fractures distinct from smooth noise clouds.
  float alpineJoints(vec2 p) {
    vec2 cell = floor(p), local = fract(p);
    float nearest = 10.0, second = 10.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 neighbour = vec2(float(x), float(y));
      vec2 delta = neighbour + alpineJointHash(cell + neighbour) - local;
      float distanceSquared = dot(delta, delta);
      if (distanceSquared < nearest) { second = nearest; nearest = distanceSquared; }
      else second = min(second, distanceSquared);
    }
    return 1.0 - smoothstep(0.025, 0.13, sqrt(second) - sqrt(nearest));
  }

  // Derivative bump uses the existing StandardMaterial view-space normal. It
  // adds small mineral/snow relief without changing the collision terrain.
  vec3 alpinePerturb(vec3 surfPos, vec3 surfNormal, vec2 dHeight, float direction) {
    vec3 sigmaX = normalize(dFdx(surfPos)), sigmaY = normalize(dFdy(surfPos));
    vec3 r1 = cross(sigmaY, surfNormal), r2 = cross(surfNormal, sigmaX);
    float determinant = dot(sigmaX, r1) * direction;
    vec3 gradient = sign(determinant) * (dHeight.x * r1 + dHeight.y * r2);
    return normalize(abs(determinant) * surfNormal - gradient);
  }
`;

const ALPINE_MATERIAL_GLSL = /* glsl */ `
  varying vec3 alpinePoint;
  varying vec3 alpineSurfaceNormal;
  uniform sampler2D alpineGrass;
  uniform sampler2D alpineRock;
  uniform sampler2D alpineSnow;
  ${ALPINE_FIELD_GLSL}
`;

/** Generated rock/snow albedos are combined with live PBR light and shadows. */
export function createAlpineTerrainMaterial(textures: AlpineTerrainTextures): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.91, metalness: 0 });
  material.name = 'Alpine granite, wind-packed snow and meadow';
  material.onBeforeCompile = shader => {
    shader.uniforms.alpineGrass = { value: textures.grassTexture };
    shader.uniforms.alpineRock = { value: textures.rockTexture };
    shader.uniforms.alpineSnow = { value: textures.snowTexture };
    shader.vertexShader = 'varying vec3 alpinePoint; varying vec3 alpineSurfaceNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      alpinePoint = position;
      alpineSurfaceNormal = normal;
    `);
    shader.fragmentShader = ALPINE_MATERIAL_GLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 alpineN = normalize(alpineSurfaceNormal);
      vec3 alpineWeights = pow(abs(alpineN), vec3(4.0));
      alpineWeights /= max(dot(alpineWeights, vec3(1.0)), 0.001);
      vec2 alpineXZ = alpinePoint.xz;
      float alpineMacro = alpineFbm(alpineXZ * 0.007);
      vec3 alpineWarp = vec3(alpineNoise(alpineXZ * 0.024), 0.0,
        alpineNoise(alpineXZ * 0.024 + 39.7)) * 1.35;
      vec3 alpineFineStone = alpineTriplanar(alpineRock, (alpinePoint + alpineWarp) / 9.0, alpineWeights);
      vec3 alpineCoarseStone = alpineTriplanar(alpineRock,
        (alpinePoint.zxy + vec3(17.3, -42.7, 11.9)) / 88.0, alpineWeights.zxy);
      // The second scale supplies strata colour, while the fine generated image retains
      // mineral grains. Their different axes stop broad repeated tile outlines.
      vec2 alpineFace = abs(alpineN.x) > abs(alpineN.z) ? alpinePoint.zy : alpinePoint.xy;
      alpineFace = mix(alpineFace, alpineXZ, smoothstep(0.78, 0.98, abs(alpineN.y)));
      vec2 alpineJointWarp = vec2(alpineFbm(alpineFace * 0.008), alpineFbm(alpineFace * 0.008 + 31.9));
      float alpineFractures = alpineJoints(alpineFace / 43.0 + alpineJointWarp * 0.57);
      float alpineBeds = alpinePoint.y * 0.052 + alpineXZ.x * 0.008 - alpineXZ.y * 0.006
        + alpineFbm(alpineXZ * 0.006) * 5.8;
      float alpineLayerWave = 0.5 + 0.5 * sin(alpineBeds);
      float alpineBedding = smoothstep(0.78, 0.97, alpineLayerWave);
      float alpineBroken = alpineFbm(alpineFace * 0.019 + alpineJointWarp * 0.8);
      vec3 alpineStone = mix(alpineFineStone, alpineCoarseStone * vec3(0.90, 0.96, 1.05), 0.43);
      alpineStone *= mix(0.56, 1.12, alpineMacro) * mix(0.78, 1.11, alpineBroken);
      // Keep the generated rock image dominant. Large joints only provide a
      // restrained tonal hint; they must not read as a tiled-cell outline.
      alpineStone *= 1.0 - alpineFractures * 0.055 - alpineBedding * 0.11;
      alpineStone *= mix(vec3(0.84, 0.91, 1.01), vec3(1.04, 1.01, 0.94), alpineMacro);
      vec3 alpineMeadow = texture2D(alpineGrass, alpineXZ / 12.0).rgb * vec3(1.22, 1.29, 1.10);

      float alpineUpright = clamp(alpineN.y, 0.0, 1.0);
      float alpineSlope = 1.0 - alpineUpright;
      float alpineRocky = clamp(smoothstep(0.08, 0.40, alpineSlope)
        + smoothstep(180.0, 390.0, alpinePoint.y) * 0.72, 0.0, 1.0);
      float alpineAspect = dot(alpineN, normalize(vec3(0.55, 0.0, 0.83)));
      float alpineWind = dot(alpineN, normalize(vec3(-0.82, 0.0, 0.57)));
      float alpineSnowLine = 335.0 + (alpineMacro - 0.5) * 100.0
        + alpineAspect * 43.0 + alpineWind * 19.0;
      float alpineDrifts = alpineFbm(vec2(alpineXZ.x * 0.025 + alpineXZ.y * 0.008,
        alpineXZ.y * 0.007 - alpineXZ.x * 0.004));
      float alpineElevationSnow = smoothstep(alpineSnowLine - 34.0, alpineSnowLine + 105.0, alpinePoint.y);
      // Flat shelves and sheltered faces accumulate; steep exposed faces keep
      // visible dark stone. Patches and elongated drifts soften the snowline.
      float alpineHolding = mix(0.10, 1.0, smoothstep(0.19, 0.80, alpineUpright));
      float alpineSheltered = clamp(0.56 - alpineWind * 0.44, 0.0, 1.0);
      float alpineChute = smoothstep(0.49, 0.72, alpineFbm(
        vec2(alpineFace.x * 0.045, alpinePoint.y * 0.006) + alpineJointWarp * 0.4));
      // Snow follows stretched drift noise rather than the stone-cell edges.
      float alpineCreviceSnow = alpineChute * 0.46
        * smoothstep(0.09, 0.45, alpineUpright) * (0.45 + alpineSheltered * 0.55);
      float alpineShelfSnow = alpineBedding * smoothstep(0.21, 0.66, alpineUpright) * 0.15;
      float alpineSnowMass = alpineElevationSnow * clamp(alpineHolding + alpineCreviceSnow + alpineShelfSnow, 0.0, 1.0) * 0.82;
      float alpinePatch = (alpineDrifts - 0.5) * 0.34 + (alpineMacro - 0.5) * 0.12;
      float alpineOutcrop = smoothstep(0.55, 0.77, alpineBroken) * smoothstep(0.06, 0.30, alpineSlope) * 0.5;
      float alpineSnowCover = smoothstep(0.10, 0.66, alpineSnowMass + alpinePatch) * (1.0 - alpineOutcrop);
      vec3 alpinePackedSnow = texture2D(alpineSnow, alpineXZ / 5.2).rgb;
      vec3 alpineSnowMacro = texture2D(alpineSnow, (alpineXZ.yx + 31.7) / 24.0).rgb;
      vec3 alpineSnowColor = mix(alpinePackedSnow, alpineSnowMacro, 0.18);
      alpineSnowColor *= mix(vec3(0.91, 0.95, 1.0), vec3(1.0, 0.995, 0.97), alpineDrifts);
      diffuseColor.rgb = mix(mix(alpineMeadow, alpineStone, alpineRocky), alpineSnowColor, alpineSnowCover);

      float alpineStoneHeight = alpineLuminance(alpineFineStone);
      float alpineSnowHeight = alpineLuminance(alpinePackedSnow);
      float alpineSurfaceHeight = mix(alpineStoneHeight * 0.095 - alpineBedding * 0.045,
        alpineSnowHeight * 0.025 + alpineDrifts * 0.018, alpineSnowCover);
      float alpinePixelMetres = max(length(dFdx(alpinePoint)), length(dFdy(alpinePoint)));
      float alpineReliefFade = 1.0 - smoothstep(0.10, 1.7, alpinePixelMetres);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      // Clear snow has a softer highlight than rough, fractured rock, without
      // turning the entire mountainside into reflective glacier ice.
      float alpineRockRoughness = 0.82 + (1.0 - alpineStoneHeight) * 0.15;
      roughnessFactor = mix(mix(0.98, alpineRockRoughness, alpineRocky),
        0.69 + (1.0 - alpineSnowHeight) * 0.16, alpineSnowCover);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec2 alpineHeightGradient = vec2(dFdx(alpineSurfaceHeight), dFdy(alpineSurfaceHeight)) * alpineReliefFade;
      normal = alpinePerturb(-vViewPosition, normal, alpineHeightGradient, faceDirection);
    `);
  };
  material.customProgramCacheKey = () => 'alpine-granite-snow-pbr-triplanar-v6';
  return material;
}

/** Generated loose-stone albedo uses transformed instance coordinates, not unit meshes. */
export function createAlpineRockMaterial({ rockTexture }: Pick<AlpineTerrainTextures, 'rockTexture'>): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, metalness: 0 });
  material.name = 'Alpine fractured granite rock';
  material.onBeforeCompile = shader => {
    shader.uniforms.alpineRock = { value: rockTexture };
    shader.vertexShader = 'varying vec3 alpineRockPoint; varying vec3 alpineRockNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec4 alpineRockVertex = vec4(transformed, 1.0);
      vec3 alpineRockVertexNormal = normal;
      #ifdef USE_INSTANCING
        mat3 alpineInstanceAxes = mat3(instanceMatrix);
        alpineRockVertexNormal /= max(vec3(dot(alpineInstanceAxes[0], alpineInstanceAxes[0]),
          dot(alpineInstanceAxes[1], alpineInstanceAxes[1]),
          dot(alpineInstanceAxes[2], alpineInstanceAxes[2])), vec3(0.00001));
        alpineRockVertexNormal = alpineInstanceAxes * alpineRockVertexNormal;
        alpineRockVertex = instanceMatrix * alpineRockVertex;
      #endif
      mat3 alpineModelAxes = mat3(modelMatrix);
      alpineRockVertexNormal /= max(vec3(dot(alpineModelAxes[0], alpineModelAxes[0]),
        dot(alpineModelAxes[1], alpineModelAxes[1]),
        dot(alpineModelAxes[2], alpineModelAxes[2])), vec3(0.00001));
      alpineRockNormal = normalize(alpineModelAxes * alpineRockVertexNormal);
      alpineRockPoint = (modelMatrix * alpineRockVertex).xyz;
    `);
    shader.fragmentShader = /* glsl */ `
      varying vec3 alpineRockPoint;
      varying vec3 alpineRockNormal;
      uniform sampler2D alpineRock;
      ${ALPINE_FIELD_GLSL}
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 alpineLooseWeights = pow(abs(normalize(alpineRockNormal)), vec3(4.0));
      alpineLooseWeights /= max(dot(alpineLooseWeights, vec3(1.0)), 0.001);
      vec3 alpineLooseFine = alpineTriplanar(alpineRock, alpineRockPoint / 7.0, alpineLooseWeights);
      vec3 alpineLooseLarge = alpineTriplanar(alpineRock,
        (alpineRockPoint.zxy + vec3(8.2, 23.7, -18.9)) / 25.0, alpineLooseWeights.zxy);
      float alpineLooseHeight = alpineLuminance(alpineLooseFine);
      float alpineLooseMottling = alpineFbm(alpineRockPoint.xz * 0.07);
      vec3 alpineLooseColour = alpineLooseFine * mix(vec3(0.9), alpineLooseLarge * 0.65 + 0.73, 0.25);
      alpineLooseColour *= mix(vec3(0.94, 0.98, 1.04), vec3(1.05, 1.01, 0.95), alpineLooseMottling);
      diffuseColor.rgb = alpineLooseColour * mix(vec3(1.0), diffuseColor.rgb * 1.5, 0.12);
      float alpineLooseMetres = max(length(dFdx(alpineRockPoint)), length(dFdy(alpineRockPoint)));
      float alpineLooseRelief = alpineLooseHeight * 0.08 * (1.0 - smoothstep(0.15, 1.7, alpineLooseMetres));
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = 0.84 + (1.0 - alpineLooseHeight) * 0.14;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      normal = alpinePerturb(-vViewPosition, normal,
        vec2(dFdx(alpineLooseRelief), dFdy(alpineLooseRelief)), faceDirection);
    `);
  };
  material.customProgramCacheKey = () => 'alpine-loose-granite-triplanar-v1';
  return material;
}
