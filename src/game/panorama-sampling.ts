/** Share the narrow wrap transition between the sky and its water reflection. */
export const PANORAMA_SAMPLING_GLSL = /* glsl */ `
  vec4 sampleDistantPanorama(sampler2D skyTexture, vec2 uv) {
    vec2 gradX = dFdx(uv);
    vec2 gradY = dFdy(uv);
    // Unwrap horizontal derivatives before sampling: a 1-to-0 UV jump must
    // not select the coarsest mip and leave a vertical stripe at the seam.
    gradX.x -= floor(gradX.x + 0.5);
    gradY.x -= floor(gradY.x + 0.5);
    uv.x = fract(uv.x);
    vec4 color = texture2DGradEXT(skyTexture, uv, gradX, gradY);
    float edgeDistance = min(uv.x, 1.0 - uv.x);
    // Generated cloud edges need a gentle transition where the panorama wraps.
    if (edgeDistance < 0.015) {
      float blend = 0.5 * (1.0 - smoothstep(0.0, 0.015, edgeDistance));
      vec4 opposite = texture2DGradEXT(skyTexture, vec2(1.0 - uv.x, uv.y),
        vec2(-gradX.x, gradX.y), vec2(-gradY.x, gradY.y));
      color = mix(color, opposite, blend);
    }
    return color;
  }
`;
