/** The harbor water reflects the same clouds and horizon that the player sees. */
export const URBAN_SKY_GLSL = /* glsl */ `
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float n=0.0,a=0.5;for(int i=0;i<5;i++){n+=noise(p)*a;p=p*2.04+vec2(12.1,4.7);a*=0.5;}return n;}
  vec3 urbanSky(vec3 ray, vec3 horizon, vec3 zenith, float time, float night) {
    vec3 d=normalize(ray);float elevation=max(d.y,0.0);
    vec3 sky=mix(horizon,zenith,pow(smoothstep(0.0,0.75,elevation),0.62));
    vec2 uv=d.xz/(max(d.y,0.02)+0.22)*2.9+vec2(time*0.007,time*0.002);
    float coverage=fbm(uv+fbm(uv*0.5));
    float cloud=smoothstep(0.50,0.70,coverage)*smoothstep(0.025,0.20,d.y);
    vec3 cloudColor=mix(vec3(0.74,0.81,0.83),vec3(0.97,0.97,0.93),smoothstep(0.5,0.75,coverage));
    sky=mix(sky,cloudColor,cloud*(1.0-night*0.86));
    vec3 sunDirection=normalize(vec3(-0.5,0.75,-0.95));
    float sun=pow(max(dot(d,sunDirection),0.0),480.0);
    return sky+vec3(0.95,0.82,0.60)*sun*(1.0-night)*0.42;
  }
`;
