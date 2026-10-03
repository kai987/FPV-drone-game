import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** A compact quadcopter whose nose points along local -Z. */
export function createDrone() {
  const model = new THREE.Group();
  model.name = 'AEROFLOW quadcopter';
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
  const lime = ownMaterial(new THREE.MeshStandardMaterial({
    color: '#c9df55', metalness: 0.18, roughness: 0.39,
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

  // The frame's dark lower sandwich stays visible beneath the cream canopy.
  box(carbon, [0, 0.035, 0], [0.58, 0.12, 0.9], true);
  box(carbonEdge, [0, 0.088, 0], [0.6, 0.028, 0.91], true);
  box(shell, [0, 0.147, -0.035], [0.54, 0.15, 0.78], true);
  for (const side of [-1, 1]) {
    box(lime, [side * 0.218, 0.23, -0.06], [0.031, 0.014, 0.59], true);
    box(carbonEdge, [side * 0.288, 0.053, 0.035], [0.028, 0.06, 0.34]);
  }

  // A removable top pack, retained by two narrow lime straps.
  box(darkRubber, [0, 0.296, 0.073], [0.29, 0.18, 0.48], true);
  box(carbonEdge, [0, 0.39, 0.07], [0.24, 0.015, 0.4], true);
  for (const z of [-0.065, 0.205]) {
    box(lime, [0, 0.405, z], [0.31, 0.022, 0.035], true);
    for (const side of [-1, 1]) box(lime, [side * 0.153, 0.303, z], [0.017, 0.195, 0.035]);
  }
  const batteryCable = box(darkRubber, [0.18, 0.255, 0.264], [0.035, 0.03, 0.23], true);
  batteryCable.rotation.y = -0.48;
  box(lime, [0.216, 0.254, 0.354], [0.052, 0.047, 0.063], true);

  // The camera housing and optical glass distinguish the front during turns.
  box(carbon, [0, 0.126, -0.477], [0.215, 0.19, 0.19], true);
  const bezelGeometry = ownGeometry(new THREE.CylinderGeometry(0.089, 0.098, 0.075, 24));
  bezelGeometry.rotateX(Math.PI / 2);
  const bezel = mesh(bezelGeometry, darkRubber);
  bezel.position.set(0, 0.132, -0.592);
  const glassGeometry = ownGeometry(new THREE.CircleGeometry(0.073, 24));
  const glass = mesh(glassGeometry, lens);
  glass.position.set(0, 0.132, -0.632);
  glass.rotation.y = Math.PI;
  const lensRimGeometry = ownGeometry(new THREE.TorusGeometry(0.077, 0.006, 6, 24));
  const lensRim = mesh(lensRimGeometry, carbonEdge);
  lensRim.position.set(0, 0.132, -0.635);
  const glint = mesh(ownGeometry(new THREE.SphereGeometry(0.012, 8, 6)), shell);
  glint.position.set(0.026, 0.159, -0.637);
  for (const side of [-1, 1]) box(frontLight, [side * 0.205, 0.141, -0.418], [0.085, 0.04, 0.034], true);
  box(backLight, [0, 0.123, 0.465], [0.27, 0.042, 0.024], true);

  // A low-profile radio aerial, angled back away from the propellers.
  const aerialGeometry = ownGeometry(new THREE.CylinderGeometry(0.014, 0.019, 0.26, 8));
  const aerial = mesh(aerialGeometry, darkRubber);
  aerial.position.set(-0.158, 0.28, 0.392);
  aerial.rotation.x = 0.52;
  const aerialTip = mesh(ownGeometry(new THREE.SphereGeometry(0.025, 8, 6)), carbon);
  aerialTip.position.set(-0.158, 0.397, 0.458);

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

  for (const x of [-0.76, 0.76]) {
    for (const z of [-0.73, 0.73]) {
      const angle = Math.atan2(x, z);
      const armLength = Math.hypot(x, z);
      const arm = box(carbon, [x * 0.5, 0.015, z * 0.5], [0.125, 0.082, armLength], true);
      arm.rotation.y = angle;
      const armRail = box(carbonEdge, [x * 0.5, 0.061, z * 0.5], [0.028, 0.012, armLength * 0.89]);
      armRail.rotation.y = angle;
      const armBand = box(z < 0 ? lime : shell, [x * 0.79, 0.061, z * 0.79], [0.13, 0.014, 0.065]);
      armBand.rotation.y = angle;

      const motor = mesh(motorGeometry, carbon);
      motor.position.set(x, 0.133, z);
      const cap = mesh(motorCapGeometry, aluminium);
      cap.position.set(x, 0.206, z);
      for (const y of [0.084, 0.12, 0.155]) {
        const rib = mesh(motorRibGeometry, carbonEdge);
        rib.rotation.x = Math.PI / 2;
        rib.position.set(x, y, z);
      }
      const motorStripe = mesh(motorRibGeometry, z < 0 ? lime : shell);
      motorStripe.rotation.x = Math.PI / 2;
      motorStripe.position.set(x, 0.19, z);

      const leg = box(carbon, [x, -0.117, z], [0.055, 0.215, 0.055], true);
      leg.rotation.z = Math.sign(x) * 0.19;
      box(darkRubber, [x + Math.sign(x) * 0.024, -0.228, z], [0.116, 0.052, 0.13], true);

      const rotor = new THREE.Group();
      rotor.position.set(x, 0.233, z);
      model.add(rotor);
      for (let bladeIndex = 0; bladeIndex < 3; bladeIndex++) {
        const blade = mesh(bladeGeometry, propellerMaterial, rotor);
        blade.rotation.y = bladeIndex * Math.PI * 2 / 3;
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
