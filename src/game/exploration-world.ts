import * as THREE from 'three';
import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';
import type { PanoramaOptions, WorldObstacle } from './world.ts';
import type { MapSpec } from './map-catalog.ts';
import type { Vec3 } from './flight.ts';
import { createNightSky } from './night-sky.ts';
import { URBAN_SKY_GLSL } from './urban-sky.ts';
import { DOWNTOWN_STREETS, buildingRoofDetails, explorationGroundHeight, getExplorationLayout, isExplorationMap } from './exploration-layout.ts';

interface InstancePose { x: number; y: number; z: number; width: number; height: number; depth: number; yaw: number; color?: string; }
interface Batch { geometry: THREE.BufferGeometry; material: THREE.Material; poses: InstancePose[]; shadows: boolean; }

/** New environments share the exact terrain and solid footprints used by the Rust world. */
export function createExplorationWorld(_runtime: RustRuntime, kernel: WorldKernel, map: MapSpec, _options: PanoramaOptions = {}) {
  if (!isExplorationMap(map.id)) throw new Error(`Unsupported exploration environment: ${map.id}`);
  const id = map.id;
  const desert = id === 'desert', city = id === 'downtown';
  const layout = getExplorationLayout(id);
  const scene = new THREE.Scene();
  scene.name = `${map.englishName} environment`;
  const daylight = desert ? '#e7c7a0' : city ? '#b8ced5' : '#bbd4e1';
  const zenith = desert ? '#547f96' : city ? '#477e9e' : '#3b82af';
  scene.background = new THREE.Color(daylight);
  scene.fog = new THREE.FogExp2(daylight, desert ? 0.00018 : 0.00014);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const obstacles: WorldObstacle[] = [];
  const pendingTextures: Promise<void>[] = [];
  let disposed = false;
  const ownGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const ownMaterial = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const standard = (color: string, roughness = 0.85, metalness = 0) => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const coneGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 9));
  const cylinderGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 10));
  const stoneGeometry = ownGeometry(new THREE.DodecahedronGeometry(0.57, 0));
  const canopyGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
  const batches = new Map<string, Batch>();
  const instances: THREE.InstancedMesh[] = [];
  const dummy = new THREE.Object3D();
  const temporaryColor = new THREE.Color();
  let seed = desert ? 45017 : city ? 98413 : 73463;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const batch = (geometry: THREE.BufferGeometry, material: THREE.Material, pose: InstancePose, shadows = true) => {
    const key = `${geometry.uuid}:${material.uuid}:${shadows}`;
    let entry = batches.get(key);
    if (!entry) { entry = { geometry, material, poses: [], shadows }; batches.set(key, entry); }
    entry.poses.push(pose);
  };
  const box = (material: THREE.Material, x: number, y: number, z: number, width: number, height: number, depth: number, yaw = 0, shadows = true, color?: string) =>
    batch(boxGeometry, material, { x, y, z, width, height, depth, yaw, color }, shadows);
  const cylinder = (material: THREE.Material, x: number, y: number, z: number, radius: number, height: number, shadows = true) =>
    batch(cylinderGeometry, material, { x, y, z, width: radius, height, depth: radius, yaw: 0 }, shadows);
  const heightAt = (x: number, z: number) => explorationGroundHeight(id, x, z);
  const nearCourse = (x: number, z: number, padding = 30) => {
    if (map.targets.some(target => Math.hypot(x - target.position.x, z - target.position.z) < target.radius + padding)) return true;
    const points = [map.spawn, ...map.checkpoints.map(checkpoint => checkpoint.position)];
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(1, dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < padding) return true;
    }
    return false;
  };

  const hemisphere = new THREE.HemisphereLight('#e8f1f6', desert ? '#a27d54' : '#556651', 2.25);
  const sun = new THREE.DirectionalLight(desert ? '#ffe2ab' : '#fff1d9', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -250, right: 250, top: 250, bottom: -250, near: 10, far: 1100 });
  sun.shadow.normalBias = 0.6; sun.shadow.bias = -0.0002; sun.shadow.radius = 2;
  sun.position.set(-180, 350, 240);
  scene.add(hemisphere, sun, sun.target);
  const atmosphere = ownMaterial(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { time: { value: 0 }, night: { value: 0 }, horizon: { value: new THREE.Color(daylight) }, zenith: { value: new THREE.Color(zenith) } },
    vertexShader: 'varying vec3 skyRay; void main(){skyRay=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 skyRay;uniform vec3 horizon;uniform vec3 zenith;uniform float time;uniform float night;${URBAN_SKY_GLSL}\nvoid main(){gl_FragColor=vec4(urbanSky(normalize(skyRay),horizon,zenith,time,night),1.0);#include <colorspace_fragment>}`.replace(';#include', ';\n#include'),
  }));
  const sky = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(8000, 48, 24)), atmosphere);
  sky.renderOrder = -100; scene.add(sky);
  const nightSky = createNightSky(); scene.add(nightSky.group);

  const loadAlpineTexture = (name: 'grass-texture.webp' | 'weathered-rock.webp') => {
    if (!_options.assets) return undefined;
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.max(1, Math.min(4, _options.maxAnisotropy ?? 1)); textures.add(texture);
    const pending = _options.assets.image(name).then(image => { if (!disposed) { texture.image = image; texture.needsUpdate = true; } });
    void pending.catch(() => {}); pendingTextures.push(pending);
    return texture;
  };
  const alpineGrass = id === 'mountains' ? loadAlpineTexture('grass-texture.webp') : undefined;
  const alpineRock = id === 'mountains' ? loadAlpineTexture('weathered-rock.webp') : undefined;

  // World-space procedural detail remains sharp at low altitude without another image download.
  const terrainMaterial = ownMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  terrainMaterial.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 environmentPoint; varying vec3 environmentNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nenvironmentPoint=position; environmentNormal=normal;');
    shader.fragmentShader = 'varying vec3 environmentPoint; varying vec3 environmentNormal;\n' + shader.fragmentShader;
    if (alpineGrass && alpineRock) {
      shader.uniforms.alpineGrass = { value: alpineGrass }; shader.uniforms.alpineRock = { value: alpineRock };
      shader.fragmentShader = 'uniform sampler2D alpineGrass; uniform sampler2D alpineRock;\n' + shader.fragmentShader;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 p=environmentPoint.xz;
      float grain=fract(sin(dot(floor(p*18.0),vec2(12.9898,78.233)))*43758.5453);
      float footprint=max(length(dFdx(p)),length(dFdy(p)));
      grain=mix(grain,0.5,smoothstep(0.025,0.18,footprint));
      ${desert ? `float wave=sin(p.x*2.6+sin(p.y*0.24)*2.0+p.y*0.46);
        float ripple=wave*0.042*(1.0-smoothstep(0.08,0.45,footprint));
        diffuseColor.rgb*=0.93+grain*0.1+ripple;` : `float crag=sin(p.x*0.77+sin(p.y*0.31))*sin(p.y*0.49+p.x*0.17);
        diffuseColor.rgb*=0.94+grain*0.08+crag*0.035;`}
      ${alpineGrass && alpineRock ? `
        vec3 terrainNormal=normalize(environmentNormal);
        vec3 weights=pow(abs(terrainNormal),vec3(5.0)); weights/=max(dot(weights,vec3(1.0)),0.001);
        vec3 grass=texture2D(alpineGrass,environmentPoint.xz/12.0).rgb;
        vec3 stone=texture2D(alpineRock,environmentPoint.yz/18.0).rgb*weights.x
          +texture2D(alpineRock,environmentPoint.xz/18.0).rgb*weights.y
          +texture2D(alpineRock,environmentPoint.xy/18.0).rgb*weights.z;
        float slope=length(terrainNormal.xz)/max(abs(terrainNormal.y),0.05);
        float rocky=clamp(smoothstep(0.28,0.70,slope)+smoothstep(220.0,430.0,environmentPoint.y)*0.45,0.0,1.0);
        float snowLine=390.0+sin(p.x*0.007+p.y*0.004)*25.0;
        float snowy=smoothstep(snowLine,snowLine+90.0,environmentPoint.y)*(1.0-smoothstep(0.7,1.5,slope)*0.8);
        vec3 grassColor=grass*vec3(1.25,1.32,1.15);
        vec3 stoneColor=stone*vec3(0.87,0.94,0.98);
        vec3 snowColor=vec3(0.85,0.90,0.92)*(0.93+dot(stone,vec3(0.299,0.587,0.114))*0.14);
        float mottling=0.96+sin(p.x*0.023+sin(p.y*0.017))*sin(p.y*0.029)*0.05;
        diffuseColor.rgb=mix(mix(grassColor,stoneColor,rocky)*mottling,snowColor,snowy);
      ` : ''}
    `);
  };
  terrainMaterial.customProgramCacheKey = () => `exploration-ground-${id}-${alpineGrass ? 'textured' : 'procedural'}-v2`;
  const sandLow = new THREE.Color('#b7955b'), sandHigh = new THREE.Color('#e1bd7d');
  const meadow = new THREE.Color('#688064'), alpine = new THREE.Color('#8e9685'), granite = new THREE.Color('#8a9497'), snow = new THREE.Color('#eff4ee');
  function terrainPatch(minX: number, maxX: number, minZ: number, maxZ: number, segmentsX: number, segmentsZ: number) {
    const geometry = ownGeometry(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, segmentsX, segmentsZ));
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const samples = new Float32Array(positions.count * 2);
    for (let index = 0; index < positions.count; index++) {
      samples[index * 2] = positions.getX(index) + (minX + maxX) / 2;
      samples[index * 2 + 1] = positions.getZ(index) + (minZ + maxZ) / 2;
    }
    const heights = kernel.sampleTerrain(samples).heights;
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index++) {
      const x = samples[index * 2], z = samples[index * 2 + 1], y = heights[index];
      positions.setXYZ(index, x, y, z);
      if (desert) {
        const variation = Math.sin(x * 0.0021 + z * 0.0011) * 0.14 + Math.cos(z * 0.004) * 0.08;
        temporaryColor.copy(sandLow).lerp(sandHigh, THREE.MathUtils.clamp(0.45 + y / 220 + variation, 0, 1));
      } else if (city) temporaryColor.set('#b6b7a7');
      else {
        const slope = Math.max(Math.abs(heightAt(x + 8, z) - heightAt(x - 8, z)), Math.abs(heightAt(x, z + 8) - heightAt(x, z - 8))) / 16;
        temporaryColor.copy(meadow).lerp(alpine, THREE.MathUtils.smoothstep(y, 130, 370));
        temporaryColor.lerp(granite, THREE.MathUtils.smoothstep(slope, 0.35, 0.8));
        const snowLine = 390 + Math.sin(x * 0.007 + z * 0.004) * 25;
        temporaryColor.lerp(snow, THREE.MathUtils.smoothstep(y, snowLine, snowLine + 90) * (1 - THREE.MathUtils.smoothstep(slope, 0.7, 1.5) * 0.8));
      }
      temporaryColor.toArray(colors, index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, terrainMaterial); mesh.name = `${map.englishName} terrain`; mesh.receiveShadow = true; scene.add(mesh);
  }
  if (city) terrainPatch(-9000, 9000, -9000, 9000, 12, 12);
  else {
    terrainPatch(-2400, 2400, -2400, 2400, 256, 256);
    terrainPatch(-9000, -2400, -9000, 9000, 40, 80);
    terrainPatch(2400, 9000, -9000, 9000, 40, 80);
    terrainPatch(-2400, 2400, -9000, -2400, 40, 40);
    terrainPatch(-2400, 2400, 2400, 9000, 40, 40);
  }

  const concrete = standard('#c2c2b4'), dark = standard('#303a3e', 0.8), white = standard('#eeecd8'), steel = standard('#53636b', 0.55, 0.5);
  const warmLight = ownMaterial(new THREE.MeshStandardMaterial({ color: '#f2dfaf', emissive: '#ffd18a', emissiveIntensity: 0.15, roughness: 0.45 }));
  const green = standard(desert ? '#52664c' : '#466b4b');
  const wood = standard('#776448');
  let pineMaterial: THREE.MeshBasicMaterial | undefined;
  let pineGeometry: THREE.PlaneGeometry | undefined;
  if (id === 'mountains' && _options.assets) {
    const texture = new THREE.Texture(); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; textures.add(texture);
    pineMaterial = ownMaterial(new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.45, side: THREE.DoubleSide, toneMapped: false }));
    pineGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
    const pending = _options.assets.image('pine-tree.webp').then(image => { if (!disposed) { texture.image = image; texture.needsUpdate = true; } });
    void pending.catch(() => {}); pendingTextures.push(pending);
  }
  const nightUniform = { value: 0 };
  const warningLights: THREE.Mesh[] = [];
  const streetLights: THREE.Vector3[] = [];
  const localLamps = Array.from({ length: 3 }, () => { const light = new THREE.PointLight('#ffdfab', 0, 75, 2); scene.add(light); return light; });
  function pavement(material: THREE.Material, x: number, z: number, width: number, depth: number, y: number) {
    box(material, x, y, z, width, 0.025, depth, 0, false);
  }
  const asphalt = standard('#495154', 0.98);
  asphalt.polygonOffset = true; asphalt.polygonOffsetFactor = -2; asphalt.polygonOffsetUnits = -4;
  white.polygonOffset = true; white.polygonOffsetFactor = -4; white.polygonOffsetUnits = -8;
  const yellow = standard('#d4b76d'); yellow.polygonOffset = true; yellow.polygonOffsetFactor = -4; yellow.polygonOffsetUnits = -8;

  if (city) {
    for (const road of layout.roads) {
      const longX = road.width > road.depth;
      const length = longX ? road.width : road.depth;
      const count = Math.ceil(length / 200);
      for (let index = 0; index < count; index++) {
        const along = -length / 2 + (index + 0.5) * length / count;
        pavement(asphalt, road.x + (longX ? along : 0), road.z + (longX ? 0 : along), longX ? length / count : road.width, longX ? road.depth : length / count, 2.045);
      }
    }
    // Each intersection has four zebra crossings. Stop bars sit outside the crossing.
    for (const x of DOWNTOWN_STREETS) for (const z of DOWNTOWN_STREETS) for (const side of [-1, 1]) {
      for (let value = -11.7; value <= 12; value += 1.8) {
        pavement(white, x + value, z + side * 23, 0.9, 6, 2.1);
        pavement(white, x + side * 23, z + value, 6, 0.9, 2.1);
      }
      pavement(white, x + side * 8, z + side * 29, 12, 0.5, 2.1);
      pavement(white, x + side * 29, z - side * 8, 0.5, 12, 2.1);
    }
    for (const street of DOWNTOWN_STREETS) for (let along = -2320; along < 2320; along += 15) {
      if (DOWNTOWN_STREETS.some(cross => Math.abs(along - cross) < 35)) continue;
      for (const offset of [-0.45, 0.45]) {
        pavement(yellow, street + offset, along, 0.13, 5.8, 2.1);
        pavement(yellow, along, street + offset, 5.8, 0.13, 2.1);
      }
      for (const lane of [-8, 8]) {
        pavement(white, street + lane, along, 0.12, 4.2, 2.1);
        pavement(white, along, street + lane, 4.2, 0.12, 2.1);
      }
    }
    const facadeMaterials = ['#668390', '#82979d', '#66747c', '#8d8d82', '#6e8690', '#a2a292'].map(color => {
      const material = standard(color, 0.45, 0.23);
      material.onBeforeCompile = shader => {
        shader.uniforms.cityNight = nightUniform;
        shader.vertexShader = 'varying vec3 cityPoint; varying vec3 cityNormal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 worldPoint=vec4(transformed,1.0);
          #ifdef USE_INSTANCING
            worldPoint=instanceMatrix*worldPoint;
          #endif
          cityPoint=(modelMatrix*worldPoint).xyz; cityNormal=normal;
        `);
        shader.fragmentShader = 'varying vec3 cityPoint; varying vec3 cityNormal; uniform float cityNight;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float side=1.0-smoothstep(0.4,0.8,abs(cityNormal.y));
          vec2 coordinates=vec2(abs(cityNormal.x)>0.5?cityPoint.z:cityPoint.x,cityPoint.y);
          vec2 cell=coordinates/vec2(3.6,3.8);
          vec2 f=fract(cell);vec2 aa=max(fwidth(cell),vec2(0.002));
          float pane=smoothstep(0.13-aa.x,0.13+aa.x,f.x)*(1.0-smoothstep(0.86-aa.x,0.86+aa.x,f.x))
            *smoothstep(0.19-aa.y,0.19+aa.y,f.y)*(1.0-smoothstep(0.84-aa.y,0.84+aa.y,f.y))*side;
          float choice=fract(sin(dot(floor(cell),vec2(12.9898,78.233)))*43758.5453);
          vec3 reflection=mix(vec3(0.15,0.25,0.29),vec3(0.43,0.60,0.65),smoothstep(4.0,180.0,cityPoint.y));
          diffuseColor.rgb=mix(diffuseColor.rgb,reflection,pane*0.88);
          float floorLine=smoothstep(0.94-aa.y,0.94+aa.y,f.y)*side;
          diffuseColor.rgb*=1.0-floorLine*0.32;
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance+=vec3(1.0,0.72+choice*0.17,0.36+choice*0.22)*pane*step(0.42,choice)*cityNight*0.85;
        `);
      };
      material.customProgramCacheKey = () => 'downtown-window-grid-v1'; return material;
    });
    for (const building of layout.buildings) {
      const material = facadeMaterials[building.variant % facadeMaterials.length];
      const y = building.base + building.height / 2;
      box(material, building.x, y, building.z, building.width, building.height, building.depth, building.yaw ?? 0);
      box(concrete, building.x, building.base + 1, building.z, building.width + 1.2, 2, building.depth + 1.2);
      const roof = building.base + building.height;
      const details = buildingRoofDetails(building);
      for (const [part, material] of [[details.cap, concrete], [details.hvac, steel]] as const)
        box(material, part.x, part.base + part.height / 2, part.z, part.width, part.height, part.depth, part.yaw ?? 0);
      // Street-facing ground entrances and terraces distinguish blocks from factories.
      box(dark, building.x, building.base + 2.7, building.z + building.depth / 2 + 0.03, 5.5, 5.4, 0.12, 0, false);
      box(steel, building.x, building.base + 5.6, building.z + building.depth / 2 + 1.2, 9, 0.25, 2.6);
      if (details.antenna) {
        const antenna = details.antenna;
        cylinder(steel, antenna.x, antenna.base + antenna.height / 2, antenna.z, antenna.width / 2, antenna.height);
        const beacon = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(0.5, 8, 6)), ownMaterial(new THREE.MeshBasicMaterial({ color: '#f47b5a' })));
        beacon.position.set(building.x, roof + 10.3, building.z); scene.add(beacon); warningLights.push(beacon);
      }
    }
    const treeCanopy = standard('#5d7959');
    const carMaterials = ['#c9c4b3', '#485b68', '#9c6656', '#8e9a91'].map(color => standard(color, 0.4, 0.28));
    // Sparse street details remain readable while approaching, without per-window meshes.
    for (const street of DOWNTOWN_STREETS) for (let along = -2180; along < 2180; along += 85) {
      if (DOWNTOWN_STREETS.some(cross => Math.abs(along - cross) < 47)) continue;
      for (const side of [-1, 1]) {
        const x = street + side * 21, z = along;
        if (nearCourse(x, z, 12)) continue;
        obstacles.push({ x, z, radius: 0.33, height: 9.5 });
        cylinder(wood, x, 4.3, z, 0.26, 4.6);
        batch(canopyGeometry, treeCanopy, { x, y: 8, z, width: 3.5, height: 4.1, depth: 3.5, yaw: 0, color: random() > 0.5 ? '#739269' : '#5e7f5e' });
        cylinder(steel, x, 6.4, z + 15, 0.09, 8.8);
        box(steel, x - side * 1.7, 10.7, z + 15, 3.6, 0.16, 0.19);
        box(warmLight, x - side * 3.1, 10.55, z + 15, 1.1, 0.12, 0.45, 0, false);
        streetLights.push(new THREE.Vector3(x - side * 3.1, 10.2, z + 15));
        if (random() < 0.3) {
          const car = carMaterials[Math.floor(random() * carMaterials.length)];
          box(car, street + side * 13, 2.85, z + 37, 1.9, 1.4, 4.6);
          box(dark, street + side * 13, 3.65, z + 37, 1.65, 0.65, 2.1, 0, false);
        }
      }
    }
    // A small civic plaza at the origin gives the drone a clear takeoff landmark.
    for (const side of [-1, 1]) for (let z = 45; z <= 145; z += 25) pavement(concrete, side * 28, z, 14, 23, 2.09);
  } else {
    // One low-poly batch for the scenery authored alongside collision boxes.
    const rock = standard(desert ? '#b37451' : '#88928b', 0.97);
    rock.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 strataPoint;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 p=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          p=instanceMatrix*p;
        #endif
        strataPoint=(modelMatrix*p).xyz;
      `);
      shader.fragmentShader = 'varying vec3 strataPoint;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float strata=sin(strataPoint.y*2.4+sin(strataPoint.x*0.07)*1.4+sin(strataPoint.z*0.06));
        float mineral=fract(sin(dot(floor(strataPoint*7.0),vec3(12.99,78.23,43.17)))*43758.5453);
        float detail=1.0-smoothstep(0.15,0.8,max(length(dFdx(strataPoint)),length(dFdy(strataPoint))));
        diffuseColor.rgb*=0.97+(strata*0.07+(mineral-0.5)*0.18)*detail;
      `);
    };
    rock.customProgramCacheKey = () => 'exploration-stratified-rock-v1';
    for (const value of layout.rocks) {
      batch(stoneGeometry, rock, { x: value.x, y: value.base + value.height * 0.47, z: value.z,
        width: value.width, height: value.height, depth: value.depth, yaw: value.yaw ?? 0, color: value.color });
    }
    for (const building of layout.buildings) {
      box(concrete, building.x, building.base + building.height / 2, building.z, building.width, building.height, building.depth);
      box(desert ? white : wood, building.x, building.base + building.height + 0.15, building.z, building.width + 1, 0.3, building.depth + 1);
      box(dark, building.x, building.base + 1.8, building.z + building.depth / 2 + 0.02, 2.2, 3.6, 0.1, 0, false);
      box(warmLight, building.x + building.width * 0.25, building.base + 2.7, building.z + building.depth / 2 + 0.03, 1.6, 1.4, 0.1, 0, false);
    }
    // Scenic trails follow the numerical ground, rather than floating over slopes.
    const curve = new THREE.CatmullRomCurve3([map.spawn, ...map.checkpoints.map(checkpoint => checkpoint.position)].map(point => new THREE.Vector3(point.x, 0, point.z)), false, 'centripetal');
    const points = curve.getPoints(350), trailPositions: number[] = [], trailIndices: number[] = [];
    for (let index = 0; index < points.length; index++) {
      const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
      const normal = new THREE.Vector2(after.z - before.z, -(after.x - before.x)).normalize();
      for (const side of [-1, 1]) {
        const x = points[index].x + normal.x * side * (desert ? 3.3 : 2.4), z = points[index].z + normal.y * side * (desert ? 3.3 : 2.4);
        trailPositions.push(x, heightAt(x, z) + 0.16, z);
      }
      if (index > 0) { const a = (index - 1) * 2, b = index * 2; trailIndices.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const trailGeometry = ownGeometry(new THREE.BufferGeometry()); trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3)); trailGeometry.setIndex(trailIndices); trailGeometry.computeVertexNormals();
    const trailMaterial = standard(desert ? '#b08b59' : '#9e9d85'); trailMaterial.polygonOffset = true; trailMaterial.polygonOffsetFactor = -3; trailMaterial.polygonOffsetUnits = -5;
    const trail = new THREE.Mesh(trailGeometry, trailMaterial); trail.name = 'Terrain-following trail'; trail.receiveShadow = true; scene.add(trail);
    if (desert) {
      for (let index = 0; index < 180; index++) {
        const x = (random() - 0.5) * 4400, z = (random() - 0.5) * 4400;
        if (nearCourse(x, z, 18)) continue;
        const y = heightAt(x, z), height = 2.8 + random() * 4;
        obstacles.push({ x, z, radius: 0.32, height });
        cylinder(green, x, y + height / 2, z, 0.22 + random() * 0.16, height);
        for (const side of [-1, 1]) {
          box(green, x + side * 0.55, y + height * 0.6, z, 1.1, 0.27, 0.3);
          cylinder(green, x + side * 0.96, y + height * 0.75, z, 0.17, height * 0.3);
        }
      }
      for (let index = 0; index < 360; index++) {
        const x = (random() - 0.5) * 4700, z = (random() - 0.5) * 4700;
        if (nearCourse(x, z, 14)) continue;
        const size = 0.8 + random() * 3.2;
        batch(stoneGeometry, rock, { x, y: heightAt(x, z) + size * 0.2, z, width: size, height: size * 0.65, depth: size * 0.8, yaw: random() * 6.28, color: '#ad8968' }, false);
      }
    } else {
      // Geometry trees retain a silhouette from above, while the snow line stays treeless.
      for (let index = 0; index < 2300; index++) {
        const x = (random() - 0.5) * 4700, z = (random() - 0.5) * 4700, y = heightAt(x, z);
        const slope = Math.abs(heightAt(x + 10, z) - heightAt(x - 10, z)) + Math.abs(heightAt(x, z + 10) - heightAt(x, z - 10));
        if (y > 330 || slope > 25 || nearCourse(x, z, 18)) continue;
        const height = 10 + random() * 11, radius = height * (0.18 + random() * 0.035);
        obstacles.push({ x, z, radius: 0.35 + height * 0.014, height });
        if (pineMaterial && pineGeometry) {
          const yaw = random() * Math.PI, tint = random() > 0.5 ? '#eff4e8' : '#cedacb';
          for (let plane = 0; plane < 2; plane++) batch(pineGeometry, pineMaterial, { x, y: y + height * 0.5, z, width: radius * 2.8, height, depth: 1, yaw: yaw + plane * Math.PI / 2, color: tint });
        } else {
          cylinder(wood, x, y + height * 0.24, z, 0.18, height * 0.48, false);
          const tint = random() > 0.5 ? '#506953' : '#3d584b';
          for (let layer = 0; layer < 3; layer++) batch(coneGeometry, green, { x, y: y + height * (0.42 + layer * 0.18), z,
            width: radius * (1 - layer * 0.24), height: height * 0.46, depth: radius * (1 - layer * 0.24), yaw: random(), color: tint });
        }
      }
    }
  }

  for (const entry of batches.values()) {
    const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, entry.poses.length);
    entry.poses.forEach((pose, index) => {
      dummy.position.set(pose.x, pose.y, pose.z); dummy.scale.set(pose.width, pose.height, pose.depth); dummy.rotation.set(0, pose.yaw, 0); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
      if (pose.color) mesh.setColorAt(index, temporaryColor.set(pose.color));
    });
    mesh.castShadow = entry.shadows; mesh.receiveShadow = true; mesh.computeBoundingSphere(); mesh.name = `${map.englishName} shared scenery`;
    instances.push(mesh); scene.add(mesh);
  }
  batches.clear();

  const ringMaterial = standard('#eeeee0', 0.48, 0.24);
  const orange = standard('#d3914f', 0.6);
  const highlightMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#d5ec58', emissive: '#b5db49', emissiveIntensity: 0.8, roughness: 0.6 }));
  const highlights: THREE.Mesh[] = [];
  const ringGeometry = new Map<number, { ring: THREE.TorusGeometry; accent: THREE.TorusGeometry; highlight: THREE.TorusGeometry }>();
  for (const [index, checkpoint] of map.checkpoints.entries()) {
    const radius = checkpoint.radius + 0.4;
    let geometry = ringGeometry.get(radius);
    if (!geometry) { geometry = { ring: ownGeometry(new THREE.TorusGeometry(radius, 0.34, 10, 72)), accent: ownGeometry(new THREE.TorusGeometry(radius, 0.355, 8, 7, 0.235)), highlight: ownGeometry(new THREE.TorusGeometry(checkpoint.radius, 0.08, 7, 72)) }; ringGeometry.set(radius, geometry); }
    const gate = new THREE.Group(); gate.position.copy(checkpoint.position); gate.rotation.y = checkpoint.yaw;
    const ring = new THREE.Mesh(geometry.ring, ringMaterial); ring.castShadow = true; gate.add(ring);
    for (let stripe = 0; stripe < 4; stripe++) { const accent = new THREE.Mesh(geometry.accent, orange); accent.rotation.z = stripe * Math.PI / 2 - 0.1175; gate.add(accent); }
    const highlight = new THREE.Mesh(geometry.highlight, highlightMaterial); highlight.visible = index === 0; highlights.push(highlight); gate.add(highlight);
    scene.add(gate);
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const context = canvas.getContext('2d')!; context.fillStyle = '#253e39'; context.fillRect(0, 0, 128, 64); context.fillStyle = '#eff1df'; context.font = '600 44px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(index + 1).padStart(2, '0'), 64, 34);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const number = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(3, 1.5)), ownMaterial(new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })));
    number.position.set(radius + 2.4, -3, 0); gate.add(number);
  }

  let night = false;
  const ready = Promise.all(pendingTextures).then(() => {});
  void ready.catch(() => {});
  const nearestLamps: { position: THREE.Vector3; distance: number }[] = [];
  return {
    scene, obstacles, ready,
    setNight(enabled: boolean) {
      night = enabled;
      const horizon = enabled ? '#101c2b' : daylight;
      scene.background = new THREE.Color(horizon); scene.fog = new THREE.FogExp2(horizon, enabled ? 0.00025 : desert ? 0.00018 : 0.00014);
      hemisphere.color.set(enabled ? '#90accb' : '#e8f1f6'); hemisphere.groundColor.set(enabled ? '#303747' : desert ? '#a27d54' : '#556651'); hemisphere.intensity = enabled ? 0.85 : 2.25;
      sun.color.set(enabled ? '#b0c9e9' : desert ? '#ffe2ab' : '#fff1d9'); sun.intensity = enabled ? 1.25 : 2.6;
      atmosphere.uniforms.night.value = enabled ? 1 : 0; atmosphere.uniforms.horizon.value.set(horizon); atmosphere.uniforms.zenith.value.set(enabled ? '#07101d' : zenith);
      warmLight.emissiveIntensity = enabled ? 2 : 0.15; nightUniform.value = enabled ? 1 : 0;
      pineMaterial?.color.set(enabled ? '#71869e' : '#ffffff');
      ringMaterial.emissive.set(enabled ? '#7c9bac' : '#000000'); ringMaterial.emissiveIntensity = enabled ? 0.5 : 0;
      nightSky.setNight(enabled); localLamps.forEach(light => { light.intensity = 0; });
    },
    update(time: number, nextCheckpoint: number, focus?: Vec3, cameraPosition?: Vec3) {
      atmosphere.uniforms.time.value = time;
      if (cameraPosition) { sky.position.copy(cameraPosition); nightSky.group.position.copy(cameraPosition); }
      if (focus) {
        sun.position.set(focus.x - 240, focus.y + (night ? 340 : 430), focus.z + (night ? -260 : 260)); sun.target.position.set(focus.x, focus.y - 30, focus.z); sun.target.updateMatrixWorld();
        nearestLamps.length = 0;
        if (night && city) for (const position of streetLights) { const distance = (position.x - focus.x) ** 2 + (position.z - focus.z) ** 2; if (distance < 110 ** 2) nearestLamps.push({ position, distance }); }
        nearestLamps.sort((a, b) => a.distance - b.distance);
        localLamps.forEach((light, index) => { const value = nearestLamps[index]; if (value) light.position.copy(value.position); light.intensity = value ? 65 : 0; });
      }
      highlights.forEach((highlight, index) => { highlight.visible = index === nextCheckpoint; if (highlight.visible) highlight.scale.setScalar(1 + Math.sin(time * 1.8) * 0.0025); });
      warningLights.forEach((light, index) => { light.visible = !night || Math.sin(time * 2.2 + index) > -0.2; });
    },
    dispose() {
      if (disposed) return; disposed = true;
      instances.forEach(mesh => mesh.dispose()); nightSky.dispose(); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); sun.shadow.map?.dispose(); scene.clear();
    },
  };
}
