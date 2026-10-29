import * as THREE from 'three';
import { getDowntownBuildingParts } from './downtown-architecture.ts';
import type { DowntownBuildingInput, DowntownFacade } from './downtown-architecture.ts';
import type { UrbanBox } from './map-layout.ts';

interface Pose extends UrbanBox { color?: string; }
interface Batch { material: THREE.Material; geometry: THREE.BufferGeometry; poses: Pose[]; shadows: boolean; }

/** Batched, metre-scaled architecture; the same stepped pieces are uploaded to Rust. */
export function createDowntownBuildings(scene: THREE.Scene, buildings: readonly DowntownBuildingInput[]) {
  const group = new THREE.Group(); group.name = 'Downtown architecture and street-facing detail'; scene.add(group);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const ownGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const ownMaterial = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const unitBox = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const unitCylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 12));
  const batches = new Map<string, Batch>();
  const night = { value: 0 };
  const lights: { material: THREE.MeshStandardMaterial; day: number; night: number }[] = [];
  const beacons: THREE.InstancedMesh[] = [];
  const standard = (color: string, roughness = 0.8, metalness = 0.05) => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const trim = standard('#c8c5b8', 0.78), darkTrim = standard('#4b5354', 0.55, 0.35), roof = standard('#8c9390', 0.94);
  const metal = standard('#8a9697', 0.58, 0.45), planter = standard('#637c5a', 0.98), canopy = standard('#42646c', 0.45, 0.28);
  const lobby = ownMaterial(new THREE.MeshStandardMaterial({ color: '#4a6267', emissive: '#f3d4a0', emissiveIntensity: 0.03, roughness: 0.24, metalness: 0.2 }));
  lights.push({ material: lobby, day: 0.03, night: 0.23 });
  const beacon = ownMaterial(new THREE.MeshStandardMaterial({ color: '#b7654e', emissive: '#e76544', emissiveIntensity: 0.2, roughness: 0.4 }));
  lights.push({ material: beacon, day: 0.2, night: 0.8 });
  const add = (material: THREE.Material, value: Pose, geometry: THREE.BufferGeometry = unitBox, shadows = true) => {
    const key = `${geometry.uuid}:${material.uuid}:${shadows}`;
    let entry = batches.get(key);
    if (!entry) { entry = { material, geometry, poses: [], shadows }; batches.set(key, entry); }
    entry.poses.push(value);
  };
  const box = (material: THREE.Material, x: number, base: number, z: number, width: number, height: number, depth: number, shadows = true, color?: string) =>
    add(material, { x, z, width, depth, base, height, color }, unitBox, shadows);
  const body = (material: THREE.Material, value: UrbanBox, color?: string) => add(material, { ...value, color });
  const facadeMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const palettes: Record<DowntownFacade, readonly string[]> = {
    glass: ['#65818d', '#788e91', '#647b86'], stone: ['#bbb6a5', '#aab2b0', '#c0b7a3'],
    brick: ['#a27b64', '#987165', '#b5987b'], residential: ['#c4bcaa', '#a7b6b0', '#b4aa96'], hotel: ['#b9a58e', '#9faeae', '#c5b9a3'],
  };
  function facade(kind: DowntownFacade, palette: number) {
    const index = palette % palettes[kind].length, key = `${kind}:${index}`;
    let material = facadeMaterials.get(key);
    if (material) return material;
    material = standard(palettes[kind][index], kind === 'glass' ? 0.34 : 0.76, kind === 'glass' ? 0.27 : 0.05);
    const spacing = kind === 'glass' ? [2.8, 3.7] : kind === 'hotel' ? [3.5, 3.4] : kind === 'brick' ? [4.4, 3.6] : [4.2, 3.3];
    const paneBounds = kind === 'glass' ? [0.055, 0.945, 0.055, 0.94] : kind === 'hotel' ? [0.24, 0.76, 0.2, 0.79] : [0.2, 0.79, 0.17, 0.78];
    const occupancy = kind === 'glass' ? 0.78 : kind === 'hotel' ? 0.65 : 0.7;
    material.onBeforeCompile = shader => {
      shader.uniforms.downtownNight = night;
      shader.vertexShader = 'varying vec3 downtownPoint; varying vec3 downtownNormal; varying float downtownSeed;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 architecturalPoint=vec4(transformed,1.0); vec2 architecturalOrigin=vec2(0.0);
        #ifdef USE_INSTANCING
          architecturalOrigin=instanceMatrix[3].xz; architecturalPoint=instanceMatrix*architecturalPoint;
        #endif
        downtownPoint=(modelMatrix*architecturalPoint).xyz; downtownNormal=normal;
        downtownSeed=fract(sin(dot(architecturalOrigin,vec2(12.9898,78.233)))*43758.5453);
      `);
      shader.fragmentShader = 'varying vec3 downtownPoint; varying vec3 downtownNormal; varying float downtownSeed; uniform float downtownNight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float architectureSide=1.0-smoothstep(0.45,0.8,abs(downtownNormal.y));
        vec2 architecturalUV=vec2(abs(downtownNormal.x)>0.5?downtownPoint.z:downtownPoint.x,downtownPoint.y);
        vec2 architectureCell=architecturalUV/vec2(${spacing[0]},${spacing[1]});
        vec2 architectureFraction=fract(architectureCell); vec2 architectureAA=max(fwidth(architectureCell),vec2(0.001));
        float architecturePane=smoothstep(${paneBounds[0]}-architectureAA.x,${paneBounds[0]}+architectureAA.x,architectureFraction.x)
          *(1.0-smoothstep(${paneBounds[1]}-architectureAA.x,${paneBounds[1]}+architectureAA.x,architectureFraction.x))
          *smoothstep(${paneBounds[2]}-architectureAA.y,${paneBounds[2]}+architectureAA.y,architectureFraction.y)
          *(1.0-smoothstep(${paneBounds[3]}-architectureAA.y,${paneBounds[3]}+architectureAA.y,architectureFraction.y))*architectureSide;
        float architectureRoom=fract(sin(dot(floor(architectureCell)+downtownSeed*317.0,vec2(17.13,53.71)))*43758.5453);
        float architectureFloor=fract(sin(floor(architectureCell.y)*17.17+downtownSeed*91.3)*43758.5453);
        float reflectedCloud=sin(architecturalUV.x*0.019+downtownPoint.y*0.031)*0.04;
        vec3 architecturalGlass=mix(vec3(0.11,0.18,0.21),vec3(0.34,0.46,0.5),smoothstep(2.0,180.0,downtownPoint.y));
        architecturalGlass+=reflectedCloud+architectureRoom*0.025;
        float interiorShade=smoothstep(0.1,0.45,architectureFraction.y)*0.055;
        architecturalGlass-=interiorShade;
        ${kind === 'brick' ? `
          vec2 brickUV=architecturalUV/vec2(0.46,0.19);brickUV.x+=mod(floor(brickUV.y),2.0)*0.5;
          vec2 brickFraction=fract(brickUV),brickAA=fwidth(brickUV);
          float mortar=(1.0-smoothstep(0.04,0.08+brickAA.x,brickFraction.x))+(1.0-smoothstep(0.045,0.09+brickAA.y,brickFraction.y));
          float brickDetail=1.0-smoothstep(0.3,1.5,max(brickAA.x,brickAA.y));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.42,0.4,0.36),clamp(mortar,0.0,1.0)*brickDetail*0.3);
        ` : ''}
        diffuseColor.rgb=mix(diffuseColor.rgb,architecturalGlass,architecturePane*${kind === 'glass' ? '0.95' : '0.86'});
        float architectureSlab=smoothstep(0.95-architectureAA.y,0.95+architectureAA.y,architectureFraction.y)*architectureSide;
        diffuseColor.rgb*=1.0-architectureSlab*0.12;
        diffuseColor.rgb*=0.98+architectureRoom*0.04;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,0.24,architecturePane*0.8);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float occupiedOffice=step(${occupancy},architectureRoom)*step(0.18,architectureFloor);
        vec3 roomColor=mix(vec3(1.0,0.72,0.43),vec3(0.72,0.84,0.88),step(0.74,architectureRoom));
        totalEmissiveRadiance+=roomColor*architecturePane*occupiedOffice*downtownNight*0.26;
      `);
    };
    material.customProgramCacheKey = () => `downtown-architecture-${kind}-v1`;
    facadeMaterials.set(key, material); return material;
  }
  const signs = new Map<string, THREE.Material>();
  function sign(label: string) {
    let material = signs.get(label);
    if (material) return material;
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#263e43'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#eee7cf'; context.font = '500 31px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(label, 128, 33);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const value = ownMaterial(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65, emissive: '#f5dcab', emissiveMap: texture, emissiveIntensity: 0.04 }));
    lights.push({ material: value, day: 0.04, night: 0.18 }); signs.set(label, value); return value;
  }
  for (const [buildingIndex, building] of buildings.entries()) {
    const parts = getDowntownBuildingParts(building), palette = buildingIndex % 3;
    for (const section of parts.bodies) {
      body(facade(section.facade, palette), section);
      // Physical piers, floor belts and sunshade fins give facades a readable depth.
      const fin = section.facade === 'glass' ? darkTrim : trim;
      const floorStep = section.facade === 'glass' ? 14.8 : 13.2;
      for (let y = section.base + floorStep; y < section.base + section.height - 2; y += floorStep) {
        box(fin, section.x, y, section.z - section.depth / 2 - 0.08, section.width + 0.2, 0.25, 0.35, false);
        box(fin, section.x, y, section.z + section.depth / 2 + 0.08, section.width + 0.2, 0.25, 0.35, false);
        box(fin, section.x - section.width / 2 - 0.08, y, section.z, 0.35, 0.25, section.depth + 0.2, false);
        box(fin, section.x + section.width / 2 + 0.08, y, section.z, 0.35, 0.25, section.depth + 0.2, false);
      }
      if (section.facade === 'glass' || section.facade === 'hotel') {
        for (const side of [-1, 1]) for (const offset of [-0.25, 0.25]) {
          box(fin, section.x + offset * section.width, section.base, section.z + side * (section.depth / 2 + 0.12), 0.24, section.height, 0.35, false);
          box(fin, section.x + side * (section.width / 2 + 0.12), section.base, section.z + offset * section.depth, 0.35, section.height, 0.24, false);
        }
      }
      if (section.facade === 'residential') {
        for (let y = section.base + 6.6; y < section.base + section.height - 1; y += 6.6) for (const side of [-1, 1]) {
          // Recessed loggias stay inside the structural footprint, keeping native contacts exact.
          for (const offset of [-0.27, 0.27]) {
            const z = section.z + side * (section.depth / 2 - 0.65);
            box(darkTrim, section.x + offset * section.width, y, z, Math.min(5, section.width * 0.25), 0.18, 1.25, false);
            box(trim, section.x + offset * section.width, y + 0.18, z + side * 0.5, Math.min(5, section.width * 0.25), 0.9, 0.12, false);
          }
        }
      }
    }
    for (const cap of parts.caps) body(roof, cap);
    body(metal, parts.hvac);
    for (const side of [-1, 1]) {
      const hvac = parts.hvac;
      box(darkTrim, hvac.x, hvac.base + 0.5, hvac.z + side * (hvac.depth / 2 + 0.01), hvac.width * 0.8, 0.6, 0.035, false);
      add(darkTrim, { x: hvac.x, z: hvac.z + side * hvac.depth * 0.22, base: hvac.base + hvac.height - 0.1,
        width: hvac.width * 0.25, depth: hvac.width * 0.25, height: 0.08 }, unitCylinder, false);
    }
    if (parts.antenna) {
      const mast = parts.antenna;
      add(metal, { ...mast, width: mast.width / 2, depth: mast.depth / 2 }, unitCylinder);
      box(beacon, mast.x, mast.base + mast.height - 0.25, mast.z, 0.42, 0.38, 0.42, false);
    }
    const podium = parts.bodies[0];
    const streetSide = Math.sign(Math.round(building.x / 400) * 400 - building.x) || 1;
    const facadeX = podium.x + streetSide * (podium.width / 2 + 0.05);
    const labels = parts.archetype === 'hotel' ? ['HOTEL', 'LOUNGE'] : parts.archetype === 'masonry' ? ['MARKET', 'ATELIER'] : ['LOBBY', 'OFFICES'];
    for (const [shop, offset] of [-0.29, 0, 0.29].entries()) {
      const z = podium.z + offset * podium.depth;
      box(lobby, facadeX, building.base + 0.3, z, 0.18, Math.min(4.6, podium.height - 1), 8.6, false);
      box(darkTrim, facadeX + streetSide * 0.04, building.base + 0.3, z, 0.21, Math.min(4.6, podium.height - 1), 0.12, false);
      box(canopy, facadeX + streetSide * 1.1, building.base + Math.min(5.3, podium.height - 0.4), z, 2.3, 0.16, 9.4);
      box(sign(labels[shop % labels.length]), facadeX + streetSide * 0.04, building.base + Math.min(4.7, podium.height - 1.0), z, 0.2, 0.65, 7.4, false);
    }
    // Low podium terraces have restrained planters rather than another identical roof.
    if (parts.bodies.length > 1) for (const side of [-1, 1]) {
      const cap = parts.caps[0], z = cap.z + side * (cap.depth / 2 - 3);
      box(trim, cap.x, cap.base + cap.height, z, Math.min(14, cap.width * 0.3), 0.8, 2.1, false);
      box(planter, cap.x, cap.base + cap.height + 0.8, z, Math.min(14, cap.width * 0.3), 0.55, 1.8, false);
    }
  }
  const transform = new THREE.Object3D(), color = new THREE.Color();
  const instances: THREE.InstancedMesh[] = [];
  for (const entry of batches.values()) {
    const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, entry.poses.length);
    entry.poses.forEach((pose, index) => {
      transform.position.set(pose.x, pose.base + pose.height / 2, pose.z);
      transform.rotation.set(0, pose.yaw ?? 0, 0); transform.scale.set(pose.width, pose.height, pose.depth); transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      if (pose.color) mesh.setColorAt(index, color.set(pose.color));
    });
    mesh.castShadow = entry.shadows; mesh.receiveShadow = true; mesh.computeBoundingSphere();
    mesh.name = `Downtown architectural batch ${instances.length + 1}`; group.add(mesh); instances.push(mesh);
    if (entry.material === beacon) beacons.push(mesh);
  }
  batches.clear();
  let disposed = false;
  return {
    group,
    setNight(enabled: boolean) { night.value = enabled ? 1 : 0; lights.forEach(light => { light.material.emissiveIntensity = enabled ? light.night : light.day; }); },
    update(time: number) { beacons.forEach(mesh => { mesh.visible = Math.sin(time * 1.6) > -0.8; }); },
    dispose() {
      if (disposed) return; disposed = true;
      instances.forEach(mesh => mesh.dispose()); geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
      group.removeFromParent(); group.clear();
    },
  };
}
