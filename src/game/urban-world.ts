import * as THREE from 'three';
import type { RustRuntime } from './rust-runtime.ts';
import type { WorldKernel } from './world-kernel.ts';
import type { PanoramaOptions, WorldObstacle } from './world.ts';
import type { MapSpec } from './map-catalog.ts';
import type { Vec3 } from './flight.ts';
import { createNightSky } from './night-sky.ts';
import { getMapLayout, HARBOR_PIERS, HARBOR_SHORE_X } from './map-layout.ts';
import type { UrbanBox, WarehouseSpec, ContainerSpec, CraneSpec, TruckSpec } from './map-layout.ts';
import { getUrbanRoadNetwork, isUrbanRoadArea } from './urban-roads.ts';

interface InstancePose { position: THREE.Vector3; scale: THREE.Vector3; quaternion: THREE.Quaternion; }

/** Industrial architecture is metre-scaled from the same layout uploaded to Rust. */
export function createUrbanWorld(_runtime: RustRuntime, kernel: WorldKernel, map: MapSpec, _panoramaOptions: PanoramaOptions = {}) {
  const harbor = map.id === 'harbor';
  const layout = getMapLayout(map.id);
  const roads = getUrbanRoadNetwork(map.id);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(harbor ? '#a6cbd6' : '#b9cbd1');
  scene.fog = new THREE.FogExp2(harbor ? '#a6cbd6' : '#b9cbd1', 0.00048);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => { geometries.add(geometry); return geometry; };
  const ownMaterial = <T extends THREE.Material>(material: T): T => { materials.add(material); return material; };
  const standard = (color: string, roughness = 0.8, metalness = 0.15) => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const concrete = standard('#93968d', 0.96, 0);
  const asphalt = standard(harbor ? '#515b5b' : '#545957', 0.96, 0);
  const paleConcrete = standard('#c1c0b0', 0.88, 0);
  const steel = standard('#455961', 0.54, 0.7);
  const darkSteel = standard('#273a42', 0.54, 0.6);
  const silver = standard('#a4b1b0', 0.46, 0.7);
  const roofRib = standard('#a2afad', 0.56, 0.55);
  const cream = standard('#d7d8c8', 0.63, 0.2);
  const roadWhite = standard('#f1f0e4', 0.86, 0);
  const yellow = standard('#d8ac41', 0.58, 0.45);
  const orange = standard('#d48835', 0.64, 0.4);
  const black = standard('#1c282b', 0.88, 0.02);
  const glass = standard('#4b7987', 0.22, 0.5);
  const windowLight = ownMaterial(new THREE.MeshStandardMaterial({ color: '#607e82', roughness: 0.22, metalness: 0.45, emissive: '#ffd890', emissiveIntensity: 0 }));
  const bulbMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#eee0a4', emissive: '#ffe3a1', emissiveIntensity: 0.18, roughness: 0.35 }));
  const warningMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#b64931', emissive: '#ee632f', emissiveIntensity: 0.25, roughness: 0.5 }));
  const brick = standard('#975a44', 0.95, 0);
  const brickMortar = standard('#685c50', 0.96, 0);
  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 20));
  const sphereGeometry = ownGeometry(new THREE.SphereGeometry(1, 12, 8));
  const batches = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; poses: InstancePose[]; shadow: boolean }>();
  const temporary = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const nightLights: THREE.PointLight[] = [];
  const beacons: THREE.Mesh[] = [];
  let lighthouseBeam: THREE.Mesh | undefined;
  let lighthouseSpot: THREE.SpotLight | undefined;
  const materialByColor = new Map<string, THREE.MeshStandardMaterial>();
  const colorMaterial = (color: string) => { let material = materialByColor.get(color); if (!material) { material = standard(color); materialByColor.set(color, material); } return material; };

  for (const [material, slabs] of [[concrete, true], [paleConcrete, true], [asphalt, false]] as const) {
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 pavedPoint;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 localPavedPoint = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            localPavedPoint = instanceMatrix * localPavedPoint;
          #endif
          pavedPoint = (modelMatrix * localPavedPoint).xyz;
        `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 pavedPoint;
        float pavementHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float pavementNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(pavementHash(i),pavementHash(i+vec2(1,0)),f.x),mix(pavementHash(i+vec2(0,1)),pavementHash(i+vec2(1,1)),f.x),f.y);}
      `).replace('#include <color_fragment>', `#include <color_fragment>
        float grain = pavementNoise(pavedPoint.xz * 21.0) * 0.15 + pavementNoise(pavedPoint.xz * 0.21) * 0.065;
        diffuseColor.rgb *= 0.88 + grain;
        ${slabs ? `vec2 joint = abs(fract(pavedPoint.xz / 11.0) - 0.5); float seam = smoothstep(0.494, 0.499, max(joint.x, joint.y)); diffuseColor.rgb *= 1.0 - seam * 0.17;` : ''}
      `);
    };
    material.customProgramCacheKey = () => slabs ? 'industrial-concrete-grain-v1' : 'industrial-asphalt-grain-v1';
  }

  function instance(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number,
    width: number, height: number, depth: number, yaw = 0, quaternion?: THREE.Quaternion, shadow = true) {
    const key = `${geometry.uuid}:${material.uuid}:${shadow}`;
    let batch = batches.get(key);
    if (!batch) { batch = { geometry, material, poses: [], shadow }; batches.set(key, batch); }
    batch.poses.push({ position: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(width, height, depth),
      quaternion: quaternion?.clone() ?? new THREE.Quaternion().setFromAxisAngle(up, yaw) });
  }
  const box = (material: THREE.Material, x: number, y: number, z: number, width: number, height: number, depth: number, yaw = 0, shadow = true) =>
    instance(boxGeometry, material, x, y, z, width, height, depth, yaw, undefined, shadow);
  const cylinder = (material: THREE.Material, x: number, y: number, z: number, radius: number, height: number) =>
    instance(cylinderGeometry, material, x, y, z, radius, height, radius);
  const beam = (material: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, radius: number) => {
    const direction = to.clone().sub(from); const midpoint = from.clone().add(to).multiplyScalar(0.5);
    instance(cylinderGeometry, material, midpoint.x, midpoint.y, midpoint.z, radius, direction.length(), radius, 0,
      new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
  };
  const local = (spec: UrbanBox, dx: number, dy: number, dz: number): THREE.Vector3 => {
    const yaw = spec.yaw ?? 0;
    return new THREE.Vector3(spec.x + dx * Math.cos(yaw) + dz * Math.sin(yaw), spec.base + dy,
      spec.z - dx * Math.sin(yaw) + dz * Math.cos(yaw));
  };
  const localBox = (spec: UrbanBox, material: THREE.Material, dx: number, dy: number, dz: number, width: number, height: number, depth: number, shadow = true) => {
    const point = local(spec, dx, dy, dz); box(material, point.x, point.y, point.z, width, height, depth, spec.yaw ?? 0, shadow);
  };
  const pavementMaterials = new Map<string, THREE.Material>();
  const land = (material: THREE.Material, x: number, z: number, width: number, depth: number, y = 2.01) => {
    // Separate road, crossing/kerb and painted-marking depth layers. At large
    // distances a centimetre of geometry alone cannot offset the ground buffer.
    const layer = y >= 2.06 ? 3 : y >= 2.03 ? 2 : 1;
    const key = `${material.uuid}:${layer}`;
    let surfaceMaterial = pavementMaterials.get(key);
    if (!surfaceMaterial) {
      surfaceMaterial = ownMaterial(material.clone());
      surfaceMaterial.onBeforeCompile = material.onBeforeCompile;
      surfaceMaterial.customProgramCacheKey = material.customProgramCacheKey;
      surfaceMaterial.polygonOffset = true;
      surfaceMaterial.polygonOffsetFactor = -layer;
      surfaceMaterial.polygonOffsetUnits = -4 * layer;
      pavementMaterials.set(key, surfaceMaterial);
    }
    box(surfaceMaterial, x, y, z, width, 0.025, depth, 0, false);
  };

  // Real structural ground, with an exposed quay face four metres above sea level.
  // The visual horizon extends past the playable Rust bounds so that high flights
  // never reveal a rectangular terrain edge. This does not expand the flyable area.
  const horizonExtent = 12000;
  if (harbor) {
    box(concrete, HARBOR_SHORE_X - horizonExtent / 2, -3, -700, horizonExtent, 10, horizonExtent, 0, false);
    HARBOR_PIERS.forEach(pier => box(concrete, pier.x, pier.base + pier.height / 2, pier.z, pier.width, pier.height, pier.depth));
    box(darkSteel, 140.08, -0.1, -700, 0.22, 4, horizonExtent, 0, false);
    for (let z = 800; z > -2390; z -= 22) box(black, 140.35, 0.3, z, 0.65, 2.6, 1.9);
    for (const pier of HARBOR_PIERS) for (const side of [-1, 1]) for (let x = 153; x < pier.x + pier.width / 2 - 10; x += 17) {
      box(black, x, 0.3, pier.z + side * pier.depth / 2, 2, 2.7, 0.65);
      cylinder(darkSteel, x, 2.45, pier.z + side * (pier.depth / 2 - 2.1), 0.45, 0.9);
    }
    box(concrete, 500, -1.5, -1030, 720, 13, 20);
    for (let x = 153; x <= 850; x += 8) box(paleConcrete, x, 5.6, -1030, 3.3, 1.2, 3.3, 0.55);
  } else box(concrete, 0, -3, -700, horizonExtent, 10, horizonExtent, 0, false);
  for (const surface of roads.surfaces) land(asphalt, surface.x, surface.z, surface.width, surface.depth);
  for (const kerb of roads.kerbs) land(paleConcrete, kerb.x, kerb.z, kerb.width, kerb.depth, 2.045);
  for (const marking of roads.markings) land(marking.kind === 'edge' ? yellow : roadWhite,
    marking.x, marking.z, marking.width, marking.depth, 2.075);
  for (let x = -420; x < -240; x += 8) {
    land(cream, x, 24, 0.1, 15, 2.07); land(cream, x + 3.5, 24, 6.9, 0.1, 2.07);
  }

  function sign(text: string, color: string, width: number, height: number, position: THREE.Vector3, yaw = 0) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 512, 128);
    context.fillStyle = '#edf0df'; context.font = '600 44px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, 256, 66);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const mesh = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(width, height)), ownMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, side: THREE.DoubleSide })));
    mesh.position.copy(position); mesh.rotation.y = yaw; scene.add(mesh);
  }

  function warehouse(spec: WarehouseSpec) {
    const body = colorMaterial(spec.color);
    const rib = colorMaterial(new THREE.Color(spec.color).multiplyScalar(0.79).getStyle());
    localBox(spec, body, 0, spec.height / 2, 0, spec.width, spec.height, spec.depth);
    localBox(spec, cream, 0, 0.5, 0, spec.width + 0.4, 1, spec.depth + 0.4);
    localBox(spec, silver, 0, spec.height + 0.17, 0, spec.width + 1.4, 0.34, spec.depth + 1.4);
    for (let x = -spec.width / 2 + 1.4; x <= spec.width / 2; x += 1.6) {
      for (const side of [-1, 1]) localBox(spec, rib, x, spec.height / 2, side * (spec.depth / 2 + 0.035), 0.12, spec.height - 1, 0.08);
      // Low contrast seams retain corrugation without subpixel shadow moiré.
      localBox(spec, roofRib, x, spec.height + 0.36, 0, 0.11, 0.035, spec.depth + 0.8, false);
    }
    for (let z = -spec.depth / 2 + 1.4; z < spec.depth / 2; z += 1.6) for (const side of [-1, 1])
      localBox(spec, rib, side * (spec.width / 2 + 0.035), spec.height / 2, z, 0.08, spec.height - 1, 0.12);
    for (const side of [-1, 1]) {
      for (let x = -spec.width / 2 + 8; x < spec.width / 2 - 7; x += 10) {
        localBox(spec, darkSteel, x, spec.height - 3.7, side * (spec.depth / 2 + 0.08), 6.6, 2.7, 0.14);
        localBox(spec, windowLight, x, spec.height - 3.7, side * (spec.depth / 2 + 0.17), 6.0, 2.3, 0.06);
        localBox(spec, silver, x, spec.height - 3.7, side * (spec.depth / 2 + 0.21), 0.09, 2.35, 0.04);
      }
      for (const x of [-spec.width * 0.28, spec.width * 0.28]) {
        localBox(spec, darkSteel, x, 3.8, side * (spec.depth / 2 + 0.15), 11.0, 7.6, 0.24);
        localBox(spec, steel, x, 3.5, side * (spec.depth / 2 + 0.3), 9.9, 6.6, 0.1);
        for (let y = 0.6; y < 6.6; y += 0.55) localBox(spec, silver, x, y, side * (spec.depth / 2 + 0.36), 9.7, 0.07, 0.04);
        localBox(spec, concrete, x, 0.2, side * (spec.depth / 2 + 1.5), 13, 0.4, 3.1);
        for (const edge of [-1, 1]) localBox(spec, yellow, x + edge * 5.3, 2.5, side * (spec.depth / 2 + 0.4), 0.4, 5, 0.15);
      }
    }
    for (const x of [-spec.width * 0.3, spec.width * 0.3]) {
      const point = local(spec, x, spec.height + 0.8, -spec.depth * 0.2);
      box(steel, point.x, point.y, point.z, 4.5, 1.6, 5.5);
      for (let z = -2; z <= 2; z += 0.6) box(silver, point.x, point.y + 0.84, point.z + z, 4.1, 0.1, 0.1);
      cylinder(silver, point.x, point.y + 2.1, point.z + 9, 0.65, 4.1);
      cylinder(darkSteel, point.x, point.y + 4.2, point.z + 9, 1.1, 0.2);
    }
    sign(spec.label, '#314b51', 19, 3.8, local(spec, 0, spec.height - 7.6, spec.depth / 2 + 0.22), spec.yaw ?? 0);
  }
  layout.warehouses.forEach(warehouse);

  function container(spec: ContainerSpec) {
    const material = colorMaterial(spec.color);
    const rib = colorMaterial(new THREE.Color(spec.color).multiplyScalar(0.76).getStyle());
    localBox(spec, material, 0, spec.height / 2, 0, spec.width, spec.height, spec.depth);
    // ISO corner castings, corrugated side panels, double doors and locking rods.
    for (const side of [-1, 1]) {
      for (let z = -spec.depth / 2 + 0.35; z < spec.depth / 2; z += 0.44)
        localBox(spec, rib, side * (spec.width / 2 + 0.025), spec.height / 2, z, 0.035, spec.height - 0.3, 0.055);
      localBox(spec, rib, side * 0.59, spec.height / 2, spec.depth / 2 + 0.035, 1.12, spec.height - 0.2, 0.055);
      localBox(spec, silver, side * 0.7, spec.height / 2, spec.depth / 2 + 0.085, 0.045, spec.height - 0.28, 0.045);
      for (const end of [-1, 1]) for (const y of [0.13, spec.height - 0.13])
        localBox(spec, steel, side * (spec.width / 2 - 0.13), y, end * (spec.depth / 2 - 0.13), 0.24, 0.22, 0.24);
    }
    localBox(spec, silver, 0, 0.07, spec.depth / 2 + 0.08, spec.width - 0.12, 0.07, 0.07);
  }
  layout.containers.forEach(container);

  for (const tank of layout.tanks) {
    cylinder(silver, tank.x, 2 + tank.height / 2, tank.z, tank.radius, tank.height);
    cylinder(steel, tank.x, 2.7, tank.z, tank.radius + 0.3, 1.4);
    cylinder(cream, tank.x, 2 + tank.height, tank.z, tank.radius, 0.5);
    for (let y = 6; y < tank.height; y += 5.2) cylinder(steel, tank.x, 2 + y, tank.z, tank.radius + 0.09, 0.11);
    for (const dx of [-0.65, 0.65]) box(darkSteel, tank.x + dx, 2 + tank.height / 2, tank.z + tank.radius + 0.5, 0.09, tank.height, 0.09);
    for (let y = 2.7; y < tank.height + 2; y += 0.6) box(steel, tank.x, y, tank.z + tank.radius + 0.5, 1.4, 0.07, 0.08);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) cylinder(steel,
      tank.x + Math.cos(angle) * (tank.radius - 0.3), tank.height + 2.6, tank.z + Math.sin(angle) * (tank.radius - 0.3), 0.055, 1.2);
  }
  for (const chimney of layout.chimneys) {
    cylinder(brick, chimney.x, 2 + chimney.height / 2, chimney.z, chimney.radius, chimney.height);
    for (let y = 3.5; y < chimney.height; y += 1.2) cylinder(brickMortar, chimney.x, y, chimney.z, chimney.radius + 0.015, 0.055);
    for (const y of [chimney.height - 18, chimney.height - 8]) cylinder(cream, chimney.x, y, chimney.z, chimney.radius + 0.025, 4.5);
    cylinder(black, chimney.x, chimney.height + 2.14, chimney.z, chimney.radius * 0.9, 0.18);
    cylinder(steel, chimney.x, chimney.height + 1.6, chimney.z, chimney.radius + 0.08, 1.2);
    const beacon = new THREE.Mesh(sphereGeometry, warningMaterial); beacon.position.set(chimney.x, chimney.height + 2.9, chimney.z);
    beacon.scale.setScalar(0.7); scene.add(beacon); beacons.push(beacon);
  }
  for (const pipe of layout.pipes) {
    const from = new THREE.Vector3(...pipe.from), to = new THREE.Vector3(...pipe.to);
    beam(silver, from, to, pipe.radius);
    const distance = from.distanceTo(to);
    for (let value = 0; value <= distance; value += 10) {
      const point = from.clone().lerp(to, value / distance);
      if (isUrbanRoadArea(map.id, point.x, point.z, 2.5)) continue;
      const supportHeight = point.y - pipe.radius - 2;
      cylinder(darkSteel, point.x, 2 + supportHeight / 2, point.z, 0.17, supportHeight);
      box(steel, point.x, 2.1, point.z, 1.5, 0.22, 1.5);
    }
  }

  function truck(spec: TruckSpec) {
    localBox(spec, colorMaterial(spec.color), 0, 2.55, -1.1, 2.65, 3.0, 10.7);
    localBox(spec, silver, 0, 1.0, 0, 2.65, 0.48, 14);
    localBox(spec, colorMaterial(spec.color), 0, 2.15, 5.45, 2.7, 3.6, 3.1);
    localBox(spec, glass, 0, 2.9, 7.03, 2.34, 1.0, 0.04);
    localBox(spec, black, 0, 1.45, 7.08, 1.95, 0.48, 0.04);
    for (const side of [-1, 1]) {
      localBox(spec, bulbMaterial, side * 1.0, 1.15, 7.05, 0.5, 0.26, 0.05);
      localBox(spec, glass, side * 1.37, 2.85, 5.4, 0.04, 1.0, 1.9);
      for (const z of [-5.0, -3.2, 4.8]) {
        const point = local(spec, side * 1.36, 0.64, z);
        instance(cylinderGeometry, black, point.x, point.y, point.z, 0.66, 0.35, 0.66, 0,
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
      }
    }
    for (let z = -5.5; z < 4; z += 0.6) localBox(spec, steel, 0, 4.1, z, 2.65, 0.08, 0.08);
  }
  layout.trucks.forEach(truck);

  function crane(spec: CraneSpec) {
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const x = spec.x + end * 31, z = spec.z + side * spec.span / 2;
      box(orange, x, (spec.height + 2) / 2, z, 4, spec.height - 2, 4);
      box(darkSteel, x, 3.3, z, 5.6, 2.6, 8.5);
      for (let y = 10; y < spec.height; y += 9) box(yellow, x, y, z, 4.15, 0.5, 4.15);
      for (let y = 3; y < spec.height; y += 1) box(silver, x, y, z + side * 2.2, 1.3, 0.075, 0.09);
    }
    for (const side of [-1, 1]) {
      const z = spec.z + side * spec.span / 2;
      box(orange, spec.x + 29, spec.height + 1.5, z, 188, 3, 3);
      box(yellow, spec.x + 29, spec.height + 5.5, z, 188, 0.9, 1.2);
      for (let x = spec.x - 62; x < spec.x + 115; x += 9) {
        beam(yellow, new THREE.Vector3(x, spec.height + 2.8, z), new THREE.Vector3(x + 9, spec.height + 5.2, z), 0.25);
        beam(yellow, new THREE.Vector3(x, spec.height + 5.2, z), new THREE.Vector3(x + 9, spec.height + 2.8, z), 0.25);
      }
      beam(steel, new THREE.Vector3(spec.x - 31, spec.height + 2.5, z), new THREE.Vector3(spec.x + 77, spec.height + 5.1, z), 0.11);
    }
    for (const end of [-1, 1]) box(orange, spec.x + end * 31, spec.height + 1, spec.z, 4, 4, spec.span + 6);
    box(steel, spec.x + 70, spec.height + 3.8, spec.z, 11, 3.0, spec.span + 4);
    box(cream, spec.x + 79, spec.height - 2.1, spec.z + 11, 5.7, 4.5, 5.2);
    box(glass, spec.x + 82, spec.height - 2.1, spec.z + 11, 0.1, 3.3, 4.0);
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const x = spec.x + 70 + end * 4.3, z = spec.z + side * 6.0;
      cylinder(steel, x, spec.height - 10.5, z, 0.065, 22);
    }
    box(yellow, spec.x + 70, spec.height - 21.6, spec.z, 10.5, 0.9, 13.5);
    sign('AEROFLOW PORT', '#714d28', 29, 4.0, new THREE.Vector3(spec.x, spec.height + 1.5, spec.z + spec.span / 2 + 1.6));
  }
  layout.cranes.forEach(crane);

  if (layout.ship) {
    const ship = layout.ship;
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-ship.width / 2, -ship.length / 2 + 23);
    hullShape.lineTo(-ship.width * 0.19, -ship.length / 2);
    hullShape.lineTo(ship.width * 0.19, -ship.length / 2);
    hullShape.lineTo(ship.width / 2, -ship.length / 2 + 23);
    hullShape.lineTo(ship.width / 2, ship.length / 2 - 16);
    hullShape.lineTo(ship.width * 0.36, ship.length / 2);
    hullShape.lineTo(-ship.width * 0.36, ship.length / 2);
    hullShape.lineTo(-ship.width / 2, ship.length / 2 - 16); hullShape.closePath();
    const hullGeometry = ownGeometry(new THREE.ExtrudeGeometry(hullShape, { depth: ship.deckY + 8, bevelEnabled: false }));
    hullGeometry.rotateX(Math.PI / 2);
    const hull = new THREE.Mesh(hullGeometry, colorMaterial('#274858')); hull.position.set(ship.x, ship.deckY, ship.z);
    hull.castShadow = true; hull.receiveShadow = true; scene.add(hull);
    const deckGeometry = ownGeometry(new THREE.ShapeGeometry(hullShape)); deckGeometry.rotateX(Math.PI / 2);
    const deck = new THREE.Mesh(deckGeometry, standard('#a29c83', 0.9)); deck.material.side = THREE.DoubleSide;
    deck.position.set(ship.x, ship.deckY + 0.025, ship.z); deck.receiveShadow = true; scene.add(deck);
    // Rust sees the exact superstructure box from map-layout.
    box(cream, ship.x, ship.deckY + 13, ship.z + 88, 35, 26, 34);
    for (let floor = 1; floor < 6; floor++) {
      for (let x = ship.x - 15; x <= ship.x + 15; x += 5) {
        box(windowLight, x, ship.deckY + floor * 4, ship.z + 105.06, 2.5, 1.5, 0.05);
        box(windowLight, x, ship.deckY + floor * 4, ship.z + 70.94, 2.5, 1.5, 0.05);
      }
      for (const side of [-1, 1]) for (let z = ship.z + 77; z < ship.z + 102; z += 6)
        box(windowLight, ship.x + side * 17.55, ship.deckY + floor * 4, z, 0.06, 1.5, 3.5);
    }
    box(glass, ship.x, ship.deckY + 25, ship.z + 70.88, 31, 1.4, 0.06);
    box(darkSteel, ship.x, ship.deckY + 30, ship.z + 95, 8, 8, 9);
    box(orange, ship.x, ship.deckY + 34.2, ship.z + 95, 8.2, 1.3, 9.2);
    cylinder(silver, ship.x - 10, ship.deckY + 34, ship.z + 87, 0.28, 16);
    for (const side of [-1, 1]) for (let z = ship.z - 110; z < ship.z + 115; z += 7)
      cylinder(cream, ship.x + side * (ship.width / 2 - 0.7), ship.deckY + 0.7, z, 0.08, 1.4);
    sign('MERIDIAN', '#274858', 27, 4, new THREE.Vector3(ship.x, 2.5, ship.z - ship.length / 2 + 0.1), Math.PI);
    for (let z = -ship.length / 2 + 35; z < ship.length / 2 - 20; z += 27) beam(black,
      new THREE.Vector3(ship.x - ship.width / 2, ship.deckY - 1, ship.z + z), new THREE.Vector3(415, 2.7, ship.z + z), 0.10);

    // Red and white harbour lighthouse with glass lantern and rotating night beam.
    cylinder(cream, 108, 22, -962, 5, 40);
    for (const y of [11, 23, 35]) cylinder(colorMaterial('#a75043'), 108, y, -962, 5.02, 5.2);
    cylinder(darkSteel, 108, 42.3, -962, 6.2, 0.8);
    cylinder(glass, 108, 44.1, -962, 3.5, 2.8);
    cylinder(darkSteel, 108, 46, -962, 4.8, 0.8);
    cylinder(bulbMaterial, 108, 44.1, -962, 0.8, 1.8);
    const lighthouseLight = new THREE.PointLight('#ffeab0', 0, 180, 1.5); lighthouseLight.position.set(108, 44.5, -962); scene.add(lighthouseLight); nightLights.push(lighthouseLight);
    lighthouseSpot = new THREE.SpotLight('#ffeac2', 0, 620, Math.PI / 18, 0.6, 1.5);
    lighthouseSpot.position.set(108, 44.5, -962); scene.add(lighthouseSpot, lighthouseSpot.target);
    lighthouseBeam = new THREE.Mesh(ownGeometry(new THREE.ConeGeometry(22, 420, 24, 1, true)),
      ownMaterial(new THREE.MeshBasicMaterial({ color: '#ffe8b4', transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
    lighthouseBeam.visible = false; scene.add(lighthouseBeam);
  }

  // Industrial kerb barriers, striped loading areas and a sparse urban light grid.
  for (const warehouse of layout.warehouses) {
    const z = warehouse.z + warehouse.depth / 2 + 10;
    for (let x = warehouse.x - warehouse.width / 2; x < warehouse.x + warehouse.width / 2; x += 6) {
      land(yellow, x, z, 2.4, 0.36, 2.075);
      land(black, x + 2.7, z, 2.4, 0.36, 2.076);
    }
  }
  for (let z = 90; z > -1060; z -= 105) for (const side of [-1, 1]) {
    if (roads.intersections.some(junction => Math.abs(z - junction.z) < 20)) continue;
    const x = side * 30;
    cylinder(steel, x, 8.5, z, 0.14, 13);
    beam(steel, new THREE.Vector3(x, 15, z), new THREE.Vector3(x - side * 3, 15.5, z), 0.13);
    box(bulbMaterial, x - side * 3, 15.5, z, 1.5, 0.28, 0.6);
    if ((z + 225) % 315 === 0 || z === 90 || z === -540) {
      const lamp = new THREE.PointLight('#ffe0a1', 0, 75, 1.5); lamp.position.set(x - side * 3, 15.1, z); scene.add(lamp); nightLights.push(lamp);
    }
  }

  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.poses.length);
    mesh.castShadow = batch.shadow; mesh.receiveShadow = true;
    batch.poses.forEach((pose, index) => {
      temporary.position.copy(pose.position); temporary.scale.copy(pose.scale); temporary.quaternion.copy(pose.quaternion); temporary.updateMatrix(); mesh.setMatrixAt(index, temporary.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); scene.add(mesh);
  }
  batches.clear();

  const hemisphere = new THREE.HemisphereLight('#e4f0f3', '#737764', 2.25); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff0d5', 2.6); sun.position.set(-180, 285, 235); sun.target.position.set(0, 0, 55);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -240; sun.shadow.camera.right = sun.shadow.camera.top = 240;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 750; sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.38;
  scene.add(sun, sun.target);
  const nightSky = createNightSky(); scene.add(nightSky.group);

  const atmosphere = ownMaterial(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { time: { value: 0 }, night: { value: 0 }, horizon: { value: new THREE.Color(harbor ? '#a6cbd6' : '#b9cbd1') }, zenith: { value: new THREE.Color(harbor ? '#347ea9' : '#527f9f') } },
    vertexShader: `varying vec3 skyRay; void main(){ skyRay=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 skyRay; uniform float time; uniform float night; uniform vec3 horizon; uniform vec3 zenith;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float n=0.0,a=0.5;for(int i=0;i<5;i++){n+=noise(p)*a;p=p*2.04+vec2(12.1,4.7);a*=0.5;}return n;}
      void main(){vec3 d=normalize(skyRay);float elevation=max(d.y,0.0);vec3 sky=mix(horizon,zenith,pow(smoothstep(0.0,0.75,elevation),0.62));
        vec2 uv=d.xz/(max(d.y,0.02)+0.22)*2.9+vec2(time*0.007,time*0.002);float coverage=fbm(uv+fbm(uv*0.5));
        float cloud=smoothstep(0.50,0.70,coverage)*smoothstep(0.025,0.20,d.y);vec3 cloudColor=mix(vec3(0.74,0.81,0.83),vec3(0.97,0.97,0.93),smoothstep(0.5,0.75,coverage));
        sky=mix(sky,cloudColor,cloud*(1.0-night*0.86));vec3 sunDirection=normalize(vec3(-0.5,0.75,-0.95));
        float sun=pow(max(dot(d,sunDirection),0.0),480.0);sky+=vec3(0.95,0.82,0.60)*sun*(1.0-night)*0.42;
        gl_FragColor=vec4(sky,1.0); #include <colorspace_fragment>
      }`,
  }));
  // Shader chunks are preprocessor directives and need their own physical line.
  atmosphere.fragmentShader = atmosphere.fragmentShader.replace('; #include', ';\n#include');
  const skyMesh = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(5900, 48, 24)), atmosphere);
  skyMesh.renderOrder = -100; scene.add(skyMesh);

  let seaMaterial: THREE.ShaderMaterial | undefined;
  if (harbor) {
    seaMaterial = ownMaterial(new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, night: { value: 0 }, shore: { value: HARBOR_SHORE_X },
        horizon: { value: new THREE.Color('#a6cbd6') }, deep: { value: new THREE.Color('#246c7d') } },
      vertexShader: `varying vec3 seaPoint; uniform float time; void main(){ vec3 p=position;
        p.y+=sin(p.x*0.07+p.z*0.021-time*0.85)*0.12+sin(p.z*0.09-p.x*0.017+time*0.65)*0.09;
        seaPoint=(modelMatrix*vec4(p,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(seaPoint,1.0); }`,
      fragmentShader: `varying vec3 seaPoint;uniform float time;uniform float night;uniform float shore;uniform vec3 horizon;uniform vec3 deep;
        float wave(vec2 p){return sin(p.x*0.26+p.y*0.16-time*1.1)*0.7+sin(p.x*0.71-p.y*0.39+time*1.4)*0.3+sin(p.y*1.8+p.x*1.4-time*2.1)*0.13;}
        void main(){vec2 p=seaPoint.xz;float e=0.4;vec3 normal=normalize(vec3((wave(p+vec2(e,0))-wave(p-vec2(e,0)))*-0.14,1.0,(wave(p+vec2(0,e))-wave(p-vec2(0,e)))*-0.14));
          vec3 eye=normalize(cameraPosition-seaPoint);float fresnel=pow(1.0-max(dot(eye,normal),0.0),3.8);vec3 reflection=mix(horizon,vec3(0.28,0.53,0.66),0.5);
          vec3 color=mix(deep,reflection,fresnel*0.7);float sparkle=pow(max(dot(reflect(-normalize(vec3(-0.5,0.8,0.7)),normal),eye),0.0),160.0);
          color+=vec3(0.95,0.92,0.76)*sparkle*(1.0-night*0.8)*0.62;float crest=pow(max(wave(p)*0.59,0.0),5.0);
          float coastal=1.0-smoothstep(0.0,7.0,abs(p.x-shore));float foam=coastal*smoothstep(0.6,1.0,sin(p.y*1.4-time*1.7))*0.34;
          color=mix(color,vec3(0.73,0.85,0.83),clamp(crest*0.11+foam,0.0,0.33)*(1.0-night*0.75));
          float fog=1.0-exp(-0.00043*distance(cameraPosition,seaPoint));color=mix(color,horizon,fog);gl_FragColor=vec4(color,1.0);
          #include <colorspace_fragment>
        }`,
    }));
    const seaGeometry = ownGeometry(new THREE.PlaneGeometry(12200, horizonExtent, 96, 96)); seaGeometry.rotateX(-Math.PI / 2);
    const ocean = new THREE.Mesh(seaGeometry, seaMaterial); ocean.position.set(5800, -2.0, -700); scene.add(ocean);
  }

  const ringGeometries = new Map<number, { ring: THREE.TorusGeometry; accent: THREE.TorusGeometry; highlight: THREE.TorusGeometry }>();
  const ringMaterial = standard('#eeeee0', 0.48, 0.24);
  const highlightMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#d5ec58', emissive: '#bad946', emissiveIntensity: 0.7, roughness: 0.6 }));
  const highlights: THREE.Mesh[] = [];
  for (const [index, checkpoint] of map.checkpoints.entries()) {
    const radius = checkpoint.radius + 0.4;
    let geometry = ringGeometries.get(radius);
    if (!geometry) {
      geometry = { ring: ownGeometry(new THREE.TorusGeometry(radius, 0.34, 10, 84)),
        accent: ownGeometry(new THREE.TorusGeometry(radius, 0.355, 8, 7, 0.235)),
        highlight: ownGeometry(new THREE.TorusGeometry(checkpoint.radius, 0.08, 7, 84)) };
      ringGeometries.set(radius, geometry);
    }
    const gate = new THREE.Group(); gate.position.set(checkpoint.position.x, checkpoint.position.y, checkpoint.position.z); gate.rotation.y = checkpoint.yaw;
    const ring = new THREE.Mesh(geometry.ring, ringMaterial); ring.castShadow = true; gate.add(ring);
    for (let stripe = 0; stripe < 4; stripe++) { const accent = new THREE.Mesh(geometry.accent, orange); accent.rotation.z = stripe * Math.PI / 2 - 0.1175; gate.add(accent); }
    const highlight = new THREE.Mesh(geometry.highlight, highlightMaterial); highlight.visible = index === 0; highlights.push(highlight); gate.add(highlight);
    const below = kernel.surfaceHeight(checkpoint.position.x, checkpoint.position.z);
    if (below > -1.5 && checkpoint.position.y - below < 55) for (const side of [-1, 1]) {
      const supportHeight = Math.max(0.1, checkpoint.position.y - below - radius * 0.753);
      const support = new THREE.Mesh(cylinderGeometry, steel); support.scale.set(0.13, supportHeight, 0.13);
      support.position.set(side * radius * 0.633, below - checkpoint.position.y + supportHeight / 2, 0); gate.add(support);
    }
    scene.add(gate);
    const signToSide = checkpoint.position.y - below < radius + 2;
    const signOffset = signToSide ? radius + 2.2 : 0;
    sign(String(index + 1).padStart(2, '0'), '#2c484d', 2.3, 1.15,
      new THREE.Vector3(checkpoint.position.x + signOffset * Math.cos(checkpoint.yaw),
        checkpoint.position.y - (signToSide ? 3.5 : radius + 1.4), checkpoint.position.z - signOffset * Math.sin(checkpoint.yaw) + 0.16), checkpoint.yaw);
  }

  let disposed = false;
  let night = false;
  // All solid boxes are registered by the map-aware Rust world kernel. Circular
  // approximations here would incorrectly seal a crane's open passage.
  const obstacles: WorldObstacle[] = [];
  return {
    scene, obstacles,
    setNight(enabled: boolean) {
      night = enabled;
      const fogColor = enabled ? '#101f2d' : harbor ? '#a6cbd6' : '#b9cbd1';
      scene.background = new THREE.Color(fogColor); scene.fog = new THREE.FogExp2(fogColor, enabled ? 0.00062 : 0.00048);
      hemisphere.color.set(enabled ? '#90afcd' : '#e4f0f3'); hemisphere.groundColor.set(enabled ? '#29333a' : '#737764'); hemisphere.intensity = enabled ? 0.7 : 2.25;
      sun.color.set(enabled ? '#a6c2e5' : '#fff0d5'); sun.intensity = enabled ? 1.0 : 2.6;
      windowLight.emissiveIntensity = enabled ? 1.4 : 0; windowLight.color.set(enabled ? '#e6bd76' : '#607e82');
      bulbMaterial.emissiveIntensity = enabled ? 2.1 : 0.18;
      warningMaterial.emissiveIntensity = enabled ? 2.8 : 0.25;
      nightLights.forEach(light => { light.intensity = enabled ? (light.position.y > 30 ? 120 : 55) : 0; });
      ringMaterial.emissive.set(enabled ? '#596e7c' : '#000000'); ringMaterial.emissiveIntensity = enabled ? 0.7 : 0;
      atmosphere.uniforms.night.value = enabled ? 1 : 0; atmosphere.uniforms.horizon.value.set(fogColor);
      atmosphere.uniforms.zenith.value.set(enabled ? '#06101e' : harbor ? '#347ea9' : '#527f9f');
      if (seaMaterial) { seaMaterial.uniforms.night.value = enabled ? 1 : 0; seaMaterial.uniforms.horizon.value.set(fogColor); seaMaterial.uniforms.deep.value.set(enabled ? '#092833' : '#246c7d'); }
      nightSky.setNight(enabled);
      if (lighthouseBeam) lighthouseBeam.visible = enabled;
      if (lighthouseSpot) lighthouseSpot.intensity = enabled ? 260 : 0;
    },
    update(time: number, nextCheckpoint: number, focus?: Vec3, cameraPosition?: Vec3) {
      atmosphere.uniforms.time.value = time;
      if (seaMaterial) seaMaterial.uniforms.time.value = time;
      if (cameraPosition) { skyMesh.position.copy(cameraPosition); nightSky.group.position.copy(cameraPosition); }
      if (focus) { sun.position.set(focus.x - 180, focus.y + (night ? 210 : 285), focus.z + (night ? -260 : 235)); sun.target.position.set(focus.x, focus.y - 12, focus.z); sun.target.updateMatrixWorld(); }
      highlights.forEach((highlight, index) => { highlight.visible = index === nextCheckpoint; if (highlight.visible) highlight.scale.setScalar(1 + Math.sin(time * 1.8) * 0.0025); });
      beacons.forEach((beacon, index) => { beacon.visible = !night || Math.sin(time * 2.5 + index) > -0.6; });
      if (lighthouseSpot && lighthouseBeam) {
        const direction = new THREE.Vector3(Math.cos(time * 0.21), -0.055, Math.sin(time * 0.21)).normalize();
        lighthouseSpot.target.position.copy(lighthouseSpot.position).addScaledVector(direction, 460); lighthouseSpot.target.updateMatrixWorld();
        lighthouseBeam.position.copy(lighthouseSpot.position).addScaledVector(direction, 210);
        lighthouseBeam.quaternion.setFromUnitVectors(up, direction.clone().negate());
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      scene.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      nightSky.dispose(); for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); for (const texture of textures) texture.dispose();
      sun.shadow.map?.dispose(); scene.clear();
    },
  };
}
