import * as THREE from 'three';

/** World-scale triplanar stone detail avoids stretched UVs on instanced boulders. */
export function createRockMaterial(texture: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({ color: '#dddcd6', roughness: 0.97, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.uniforms.rockMap = { value: texture };
    shader.vertexShader = `varying vec3 rockPoint;\nvarying vec3 rockNormal;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        rockPoint = position;
        rockNormal = normal;
        #ifdef USE_INSTANCING
          rockPoint *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          rockPoint += instanceMatrix[3].xyz * 0.037;
        #endif
      `);
    shader.fragmentShader = `uniform sampler2D rockMap;\nvarying vec3 rockPoint;\nvarying vec3 rockNormal;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `
        vec3 weights = pow(abs(normalize(rockNormal)), vec3(4.0));
        weights /= max(dot(weights, vec3(1.0)), 0.0001);
        vec3 stone = texture2D(rockMap, rockPoint.yz * 0.45).rgb * weights.x
          + texture2D(rockMap, rockPoint.xz * 0.45).rgb * weights.y
          + texture2D(rockMap, rockPoint.xy * 0.45).rgb * weights.z;
        diffuseColor.rgb *= stone;
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(0.96 - stone.g * 0.16, 0.72, 1.0);
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        float relief = dot(stone, vec3(0.299, 0.587, 0.114)) * 0.09;
        vec3 surfaceX = dFdx(-vViewPosition);
        vec3 surfaceY = dFdy(-vViewPosition);
        vec3 perpendicularX = cross(surfaceY, normal);
        vec3 perpendicularY = cross(normal, surfaceX);
        float determinant = dot(surfaceX, perpendicularX);
        vec3 reliefGradient = sign(determinant) * (dFdx(relief) * perpendicularX + dFdy(relief) * perpendicularY);
        normal = normalize(abs(determinant) * normal - reliefGradient);
      `);
  };
  material.customProgramCacheKey = () => 'aeroflow-triplanar-stone-v1';
  return material;
}
