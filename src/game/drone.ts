import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DEFAULT_DRONE_ID, getDroneSpec } from './drone-catalog.ts';
import type { DroneId } from './drone-catalog.ts';

/** A compact quadcopter whose nose points along local -Z. */
export function createDrone(id: DroneId = DEFAULT_DRONE_ID) {
  const spec = getDroneSpec(id);
  const shape = {
    cinewhoop: { motorX: 0.56, motorZ: 0.53, propRadius: 0.38, motorScale: 0.8, armWidth: 0.09, bodyWidth: 0.56, bodyLength: 0.66, batteryWidth: 0.29, batteryHeight: 0.15, batteryLength: 0.34 },
    freestyle: { motorX: 0.76, motorZ: 0.73, propRadius: 0.505, motorScale: 1, armWidth: 0.125, bodyWidth: 0.58, bodyLength: 0.9, batteryWidth: 0.29, batteryHeight: 0.18, batteryLength: 0.48 },
    racer: { motorX: 0.64, motorZ: 0.88, propRadius: 0.505, motorScale: 0.86, armWidth: 0.075, bodyWidth: 0.35, bodyLength: 0.98, batteryWidth: 0.23, batteryHeight: 0.13, batteryLength: 0.51 },
    explorer: { motorX: 1.04, motorZ: 1.03, propRadius: 0.66, motorScale: 1.2, armWidth: 0.15, bodyWidth: 0.66, bodyLength: 1.12, batteryWidth: 0.42, batteryHeight: 0.26, batteryLength: 0.75 },
    vector: { motorX: 0.82, motorZ: 0.82, propRadius: 0.55, motorScale: 1.05, armWidth: 0.12, bodyWidth: 0.48, bodyLength: 1.02, batteryWidth: 0.3, batteryHeight: 0.14, batteryLength: 0.65 },
    falcon: { motorX: 0.77, motorZ: 1.03, propRadius: 0.57, motorScale: 1.15, armWidth: 0.11, bodyWidth: 0.46, bodyLength: 1.85, batteryWidth: 0.32, batteryHeight: 0.14, batteryLength: 0.89 },
  }[spec.id];
  const propScale = shape.propRadius / 0.505;
  const slim = spec.id === 'racer';
  const ducted = spec.id === 'cinewhoop';
  const longRange = spec.id === 'explorer';
  const speedX = spec.id === 'vector';
  const streamlined = spec.id === 'falcon';
  const enclosed = speedX || streamlined;
  const model = new THREE.Group();
  model.name = `AEROFLOW ${spec.name}`;
  model.userData.droneId = spec.id;
  model.userData.frame = spec.frame;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  const ownMaterial = <T extends THREE.Material>(material: T): T => {
    materials.add(material);
    return material;
  };

  const carbon = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#1d2824', metalness: 0.46, roughness: 0.32,
  }));
  const carbonEdge = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#455047', metalness: 0.63, roughness: 0.38,
  }));
  const shell = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#eeeadd', metalness: 0.18, roughness: 0.34,
  }));
  const speedShell = ownMaterial(new THREE.MeshStandardMaterial({
    color: speedX ? '#d8e6e5' : '#e8e2d2', metalness: 0.24, roughness: 0.3,
  }));
  const lime = ownMaterial(new THREE.MeshStandardMaterial({
    color: spec.color, metalness: 0.18, roughness: 0.39,
  }));
  const darkRubber = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#111916', roughness: 0.86,
  }));
  const aluminium = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#8c9690', metalness: 0.87, roughness: 0.24,
  }));
  const lens = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#21435a', emissive: '#173041', emissiveIntensity: 0.25,
    metalness: 0.82, roughness: 0.08,
  }));
  const frontLight = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#e1ed95', emissive: '#c7e94c', emissiveIntensity: 1.6,
    roughness: 0.3, metalness: 0.05,
  }));
  const backLight = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#dc5041', emissive: '#ff3528', emissiveIntensity: 1.1,
    roughness: 0.25, metalness: 0.05,
  }));
  const propellerMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#28362c', roughness: 0.28, metalness: 0.43,
  }));
  const propellerBlurMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    color: '#d9e2c8', transparent: true, opacity: 0.13,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  }));

  const unitBox = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const roundedBox = ownGeometry(new RoundedBoxGeometry(1, 1, 1, 3, 0.12));
  const motorGeometry = ownGeometry(new THREE.CylinderGeometry(0.112, 0.122, 0.16, 20));
  const motorCapGeometry = ownGeometry(new THREE.CylinderGeometry(0.112, 0.112, 0.035, 20));
  const motorRibGeometry = ownGeometry(new THREE.TorusGeometry(0.116, 0.007, 5, 20));
  const rotorHubGeometry = ownGeometry(new THREE.CylinderGeometry(0.045, 0.054, 0.048, 16));
  const rotorDiscGeometry = ownGeometry(new THREE.CircleGeometry(0.505, 48));
  rotorDiscGeometry.rotateX(-Math.PI / 2);
  const screwGeometry = ownGeometry(new THREE.CylinderGeometry(0.017, 0.017, 0.014, 8));

  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = model) => {
    const part = new THREE.Mesh(geometry, material);
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  };
  const box = (
    material: THREE.Material,
    position: [number, number, number],
    scale: [number, number, number],
    rounded = false,
    parent: THREE.Object3D = model,
  ) => {
    const part = mesh(rounded ? roundedBox : unitBox, material, parent);
    part.position.set(...position);
    part.scale.set(...scale);
    return part;
  };

  // Loft simple elliptical cross sections for game styling, without copying a prototype.
  const fairingGeometry = (sections: Array<[number, number, number]>, segments = 12) => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [z, width, height] of sections) {
      for (let point = 0; point < segments; point++) {
        const angle = point * Math.PI * 2 / segments;
        positions.push(Math.cos(angle) * width, Math.sin(angle) * height, z);
      }
    }
    for (let section = 0; section < sections.length - 1; section++) for (let point = 0; point < segments; point++) {
      const a = section * segments + point;
      const b = section * segments + (point + 1) % segments;
      const c = a + segments;
      const d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
    const front = positions.length / 3;
    positions.push(0, 0, sections[0][0]);
    const rear = positions.length / 3;
    positions.push(0, 0, sections[sections.length - 1][0]);
    const lastRing = (sections.length - 1) * segments;
    for (let point = 0; point < segments; point++) {
      const next = (point + 1) % segments;
      indices.push(front, next, point, rear, lastRing + point, lastRing + next);
    }
    const geometry = ownGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };

  // The frame's dark lower sandwich stays visible beneath the cream canopy.
  box(carbon, [0, 0.035, 0], [shape.bodyWidth, slim ? 0.075 : 0.12, shape.bodyLength], true);
  box(carbonEdge, [0, 0.088, 0], [shape.bodyWidth + 0.02, 0.028, shape.bodyLength + 0.01], true);
  if (enclosed) {
    const sections: Array<[number, number, number]> = speedX
      ? [[-0.63, 0.008, 0.012], [-0.44, 0.15, 0.065], [-0.1, 0.245, 0.125], [0.35, 0.22, 0.105], [0.58, 0.045, 0.024], [0.63, 0.004, 0.008]]
      : [[-1.13, 0.004, 0.006], [-0.87, 0.14, 0.085], [-0.4, 0.235, 0.155], [0.35, 0.23, 0.15], [0.87, 0.085, 0.065], [1.08, 0.004, 0.007]];
    const canopy = mesh(fairingGeometry(sections, speedX ? 8 : 16), speedShell);
    canopy.position.y = speedX ? 0.145 : 0.18;
    canopy.name = speedX ? 'VECTOR low racing canopy' : 'FALCON streamlined fuselage';
    // The upper optical panel and coloured spine give each shell a readable orientation.
    const windshield = mesh(fairingGeometry(speedX
      ? [[-0.49, 0.004, 0.004], [-0.34, 0.11, 0.026], [-0.16, 0.12, 0.018], [-0.13, 0.004, 0.004]]
      : [[-0.5, 0.004, 0.004], [-0.31, 0.1, 0.032], [-0.14, 0.12, 0.022], [-0.08, 0.004, 0.004]], 8), lens);
    windshield.position.y = speedX ? 0.237 : 0.297;
    windshield.position.z = streamlined ? -0.29 : 0;
    box(lime, [0, speedX ? 0.276 : 0.336, speedX ? 0.08 : 0.13], [0.065, 0.009, speedX ? 0.38 : 0.73], true);
  } else if (slim) {
    box(carbon, [0, 0.147, -0.08], [0.29, 0.025, 0.82]);
    for (const side of [-1, 1]) for (const z of [-0.32, 0.25]) box(aluminium, [side * 0.12, 0.12, z], [0.021, 0.095, 0.021]);
    box(lime, [0, 0.164, -0.19], [0.075, 0.018, 0.45]);
  } else box(shell, [0, 0.147, -0.035], [shape.bodyWidth - 0.04, 0.15, shape.bodyLength * 0.8667], true);
  for (const side of [-1, 1]) {
    if (!slim && !enclosed) box(lime, [side * shape.bodyWidth * 0.376, 0.23, -0.06], [0.031, 0.014, shape.bodyLength * 0.656], true);
    box(carbonEdge, [side * (shape.bodyWidth / 2 - 0.002), 0.053, 0.035], [0.028, 0.06, shape.bodyLength * 0.378]);
  }

  // A removable top pack, retained by two narrow lime straps.
  const batteryY = enclosed ? -0.045 : slim ? 0.235 : 0.206 + shape.batteryHeight / 2;
  const batteryTop = batteryY + shape.batteryHeight / 2;
  box(darkRubber, [0, batteryY, 0.073], [shape.batteryWidth, shape.batteryHeight, shape.batteryLength], true);
  box(carbonEdge, [0, batteryTop + 0.004, 0.07], [shape.batteryWidth - 0.05, 0.015, shape.batteryLength * 0.833], true);
  for (const z of [0.07 - shape.batteryLength * 0.28, 0.07 + shape.batteryLength * 0.28]) {
    box(lime, [0, batteryTop + 0.019, z], [shape.batteryWidth + 0.02, 0.022, 0.035], true);
    for (const side of [-1, 1]) box(lime, [side * (shape.batteryWidth / 2 + 0.008), batteryY + 0.007, z], [0.017, shape.batteryHeight + 0.015, 0.035]);
  }
  const batteryCable = box(darkRubber, [0.18, enclosed ? -0.06 : 0.255, 0.264], [0.035, 0.03, 0.23], true);
  batteryCable.rotation.y = -0.48;
  box(lime, [0.216, enclosed ? -0.06 : 0.254, 0.354], [0.052, 0.047, 0.063], true);

  // The camera housing and optical glass distinguish the front during turns.
  const cameraZ = -shape.bodyLength * 0.53;
  box(carbon, [0, 0.126, cameraZ], [slim ? 0.18 : 0.215, 0.19, 0.19], true);
  const bezelGeometry = ownGeometry(new THREE.CylinderGeometry(0.089, 0.098, 0.075, 24));
  bezelGeometry.rotateX(Math.PI / 2);
  const bezel = mesh(bezelGeometry, darkRubber);
  bezel.position.set(0, 0.132, cameraZ - 0.115);
  const glassGeometry = ownGeometry(new THREE.CircleGeometry(0.073, 24));
  const glass = mesh(glassGeometry, lens);
  glass.position.set(0, 0.132, cameraZ - 0.155);
  glass.rotation.y = Math.PI;
  const lensRimGeometry = ownGeometry(new THREE.TorusGeometry(0.077, 0.006, 6, 24));
  const lensRim = mesh(lensRimGeometry, carbonEdge);
  lensRim.position.set(0, 0.132, cameraZ - 0.158);
  const glint = mesh(ownGeometry(new THREE.SphereGeometry(0.012, 8, 6)), shell);
  glint.position.set(0.026, 0.159, cameraZ - 0.16);
  for (const side of [-1, 1]) box(frontLight, [side * shape.bodyWidth * 0.353, 0.141, -shape.bodyLength * 0.464], [slim ? 0.045 : 0.085, 0.04, 0.034], true);
  box(backLight, [0, 0.123, shape.bodyLength * 0.517], [shape.bodyWidth * 0.466, 0.042, 0.024], true);

  // A low-profile radio aerial, angled back away from the propellers.
  const aerialHeight = longRange ? 0.66 : slim || enclosed ? 0.18 : 0.26;
  const aerialGeometry = ownGeometry(new THREE.CylinderGeometry(0.014, 0.019, aerialHeight, 8));
  const aerial = mesh(aerialGeometry, darkRubber);
  const aerialZ = shape.bodyLength * 0.435;
  aerial.position.set(-0.158, longRange ? 0.5 : 0.28, aerialZ);
  aerial.rotation.x = longRange ? 0.16 : 0.52;
  const aerialTip = mesh(ownGeometry(new THREE.SphereGeometry(0.025, 8, 6)), carbon);
  aerialTip.position.set(-0.158, (longRange ? 0.5 : 0.28) + Math.cos(aerial.rotation.x) * aerialHeight / 2,
    aerialZ + Math.sin(aerial.rotation.x) * aerialHeight / 2);
  if (longRange) {
    const gps = mesh(ownGeometry(new THREE.CylinderGeometry(0.11, 0.11, 0.055, 20)), shell);
    gps.position.set(0.19, batteryTop + 0.06, 0.39);
    const secondAerial = mesh(aerialGeometry, carbonEdge);
    secondAerial.position.set(0.18, 0.43, aerialZ - 0.04); secondAerial.scale.y = 0.7; secondAerial.rotation.z = -0.15;
    box(carbon, [0, -0.095, 0.07], [0.42, 0.065, 0.88], true);
  }
  if (streamlined) {
    const finShape = new THREE.Shape();
    finShape.moveTo(0.5, 0); finShape.lineTo(0.83, 0.31); finShape.lineTo(1.08, 0.06); finShape.lineTo(1.08, 0); finShape.closePath();
    const finGeometry = ownGeometry(new THREE.ExtrudeGeometry(finShape, { depth: 0.02, bevelEnabled: false, steps: 1 }));
    // Shape X becomes local Z; extrusion becomes a narrow local X thickness.
    finGeometry.rotateY(-Math.PI / 2);
    for (const side of [-1, 1]) {
      const fin = mesh(finGeometry, lime);
      fin.position.set(side * 0.11, 0.22, 0);
      fin.rotation.z = -side * 0.2;
      fin.name = 'FALCON tail fin';
    }
    const tailplane = box(carbonEdge, [0, 0.18, 0.87], [0.69, 0.025, 0.2], true);
    tailplane.name = 'FALCON tailplane';
  }

  // Curved, swept blades are actual extruded geometry, rather than flat sprites.
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.052, -0.025);
  bladeShape.bezierCurveTo(0.17, -0.06, 0.38, -0.064, 0.478, -0.051);
  bladeShape.quadraticCurveTo(0.52, -0.028, 0.497, 0.008);
  bladeShape.bezierCurveTo(0.37, 0.038, 0.19, 0.046, 0.061, 0.026);
  bladeShape.closePath();
  const bladeGeometry = ownGeometry(new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.01, bevelEnabled: true, bevelSegments: 1, steps: 1,
    bevelSize: 0.003, bevelThickness: 0.002, curveSegments: 10,
  }));
  bladeGeometry.rotateX(-Math.PI / 2);
  const bladeTipGeometry = ownGeometry(new RoundedBoxGeometry(0.036, 0.013, 0.059, 2, 0.008));
  const rotors: THREE.Group[] = [];
  const blurDiscs: THREE.Mesh[] = [];
  const rotations: number[] = [];
  let ductGeometry: THREE.BufferGeometry | undefined;
  if (ducted) {
    const contour = new THREE.Shape();
    contour.absarc(0, 0, shape.propRadius + 0.062, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, shape.propRadius + 0.012, 0, Math.PI * 2, true);
    contour.holes.push(hole);
    ductGeometry = ownGeometry(new THREE.ExtrudeGeometry(contour, { depth: 0.16, bevelEnabled: true, bevelSize: 0.009, bevelThickness: 0.006, bevelSegments: 1, curveSegments: 24, steps: 1 }));
    ductGeometry.rotateX(-Math.PI / 2);
  }
  const podGeometry = streamlined ? fairingGeometry([
    [-0.35, 0.004, 0.005], [-0.18, 0.11, 0.09], [0.02, 0.15, 0.13], [0.22, 0.105, 0.085], [0.4, 0.004, 0.005],
  ], 12) : undefined;

  for (const x of [-shape.motorX, shape.motorX]) {
    for (const z of [-shape.motorZ, shape.motorZ]) {
      const angle = Math.atan2(x, z);
      const armLength = Math.hypot(x, z);
      const arm = box(carbon, [x * 0.5, 0.015, z * 0.5], [shape.armWidth, slim ? 0.052 : 0.082, armLength], true);
      arm.rotation.y = angle;
      const armRail = box(carbonEdge, [x * 0.5, 0.061, z * 0.5], [0.028, 0.012, armLength * 0.89]);
      armRail.rotation.y = angle;
      const armBand = box(z < 0 ? lime : shell, [x * 0.79, 0.061, z * 0.79], [0.13, 0.014, 0.065]);
      armBand.rotation.y = angle;

      const motor = mesh(motorGeometry, carbon);
      motor.position.set(x, 0.133, z);
      motor.scale.setScalar(shape.motorScale);
      if (podGeometry) {
        const pod = mesh(podGeometry, speedShell);
        pod.position.set(x, 0.065, z);
        pod.name = 'FALCON motor pod';
        box(lime, [x, 0.17, z + 0.2], [0.045, 0.009, 0.2], true);
      }
      const cap = mesh(motorCapGeometry, aluminium);
      cap.position.set(x, 0.206, z);
      cap.scale.setScalar(shape.motorScale);
      for (const y of [0.084, 0.12, 0.155]) {
        const rib = mesh(motorRibGeometry, carbonEdge);
        rib.rotation.x = Math.PI / 2;
        rib.position.set(x, y, z);
        rib.scale.setScalar(shape.motorScale);
      }
      const motorStripe = mesh(motorRibGeometry, z < 0 ? lime : shell);
      motorStripe.rotation.x = Math.PI / 2;
      motorStripe.position.set(x, 0.19, z);
      motorStripe.scale.setScalar(shape.motorScale);
      if (ductGeometry) {
        const guard = mesh(ductGeometry, shell);
        guard.name = 'Protective propeller duct'; guard.position.set(x, 0.145, z);
        for (let brace = 0; brace < 3; brace++) {
          const a = brace * Math.PI * 2 / 3;
          const support = box(carbon, [x + Math.cos(a) * 0.2, 0.113, z + Math.sin(a) * 0.2], [0.022, 0.032, 0.39]);
          support.rotation.y = Math.PI / 2 - a;
        }
      }

      const leg = box(carbon, [x, -0.117, z], [0.055, 0.215, 0.055], true);
      leg.rotation.z = Math.sign(x) * 0.19;
      box(darkRubber, [x + Math.sign(x) * 0.024, -0.228, z], [0.116, 0.052, 0.13], true);

      const rotor = new THREE.Group();
      rotor.position.set(x, 0.233, z);
      rotor.scale.setScalar(propScale);
      model.add(rotor);
      const bladeCount = ducted ? 4 : slim || longRange || enclosed ? 2 : 3;
      for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex++) {
        const blade = mesh(bladeGeometry, propellerMaterial, rotor);
        blade.rotation.y = bladeIndex * Math.PI * 2 / bladeCount;
        const tip = mesh(bladeTipGeometry, z < 0 ? lime : shell, rotor);
        const tipRadius = 0.472;
        tip.position.set(Math.cos(blade.rotation.y) * tipRadius, 0.008, -Math.sin(blade.rotation.y) * tipRadius);
        tip.rotation.y = blade.rotation.y;
      }
      const hub = mesh(rotorHubGeometry, carbon, rotor);
      hub.position.y = 0.021;
      const hubScrew = mesh(screwGeometry, aluminium, rotor);
      hubScrew.position.y = 0.051;
      const blur = mesh(rotorDiscGeometry, propellerBlurMaterial);
      blur.position.set(x, 0.241, z);
      blur.scale.setScalar(propScale);
      blur.castShadow = false;
      blur.receiveShadow = false;
      blur.visible = false;
      blurDiscs.push(blur);
      rotors.push(rotor);
      rotations.push(Math.sign(x * z));
    }
  }

  let lastTime: number | undefined;
  let disposed = false;
  return {
    model,
    update(time: number, flying: boolean, speed: number) {
      if (disposed) return;
      const dt = lastTime === undefined ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, 0.08);
      lastTime = time;
      const rotorSpeed = flying ? 64 + THREE.MathUtils.clamp(speed, 0, 50) * 1.1 : 2.8;
      rotors.forEach((rotor, index) => {
        rotor.rotation.y = (rotor.rotation.y + rotorSpeed * dt * rotations[index]) % (Math.PI * 2);
        blurDiscs[index].visible = flying;
      });
      frontLight.emissiveIntensity = (flying ? 1.85 : 1.25) + Math.sin(time * 2.4) * 0.075;
      backLight.emissiveIntensity = flying ? 1.35 + Math.sin(time * 3.3) * 0.13 : 0.85;
      propellerBlurMaterial.opacity = flying ? 0.1 + Math.min(Math.max(speed, 0), 35) * 0.0011 : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      model.clear();
      model.removeFromParent();
    },
  };
}
