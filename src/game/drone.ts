import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_DRONE_ID, getDroneSpec } from './drone-catalog.ts';
import type { DroneId } from './drone-catalog.ts';

/** Fictional FPV aircraft: FALCON's nose is local +Y; the other five point -Z. */
export function createDrone(id: DroneId = DEFAULT_DRONE_ID) {
  const spec = getDroneSpec(id);
  if (spec.id === 'falcon') return createFalconDrone();
  const shape = {
    cinewhoop: { motorX: 0.54, motorZ: 0.53, radius: 0.38, motor: 0.8, arm: 0.095, width: 0.43, length: 0.76, battery: [0.26, 0.18, 0.43], tilt: 0.28, blades: 4 },
    freestyle: { motorX: 0.76, motorZ: 0.73, radius: 0.505, motor: 1, arm: 0.12, width: 0.48, length: 0.96, battery: [0.34, 0.22, 0.61], tilt: 0.42, blades: 3 },
    racer: { motorX: 0.64, motorZ: 0.88, radius: 0.505, motor: 0.91, arm: 0.08, width: 0.34, length: 0.94, battery: [0.26, 0.17, 0.55], tilt: 0.54, blades: 2 },
    explorer: { motorX: 1.04, motorZ: 1.03, radius: 0.66, motor: 1.16, arm: 0.14, width: 0.53, length: 1.16, battery: [0.41, 0.27, 0.88], tilt: 0.32, blades: 2 },
    vector: { motorX: 0.82, motorZ: 0.82, radius: 0.55, motor: 1.06, arm: 0.11, width: 0.43, length: 1.04, battery: [0.33, 0.18, 0.68], tilt: 0.48, blades: 2 },
  }[spec.id];
  const cine = spec.id === 'cinewhoop';
  const race = spec.id === 'racer';
  const range = spec.id === 'explorer';
  const vector = spec.id === 'vector';
  const model = new THREE.Group();
  model.name = `AEROFLOW ${spec.name}`;
  model.userData.droneId = spec.id;
  model.userData.frame = spec.frame;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const ownGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const ownMaterial = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const group = (name: string, parent: THREE.Object3D = model) => {
    const value = new THREE.Group(); value.name = name; parent.add(value); return value;
  };
  const frame = group('Open carbon frame and arm wiring');
  const electronics = group('Flight controller and ESC stack');
  const battery = group('Battery pack and woven retaining straps');
  const cameraMount = group('Front FPV camera side plates');
  const aerials = group('Radio antennas and navigation hardware');
  const body = group('Model-specific guards and fairings');

  // A small generated weave needs neither a browser canvas nor an external image.
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const horizontal = ((x >> 2) + (y >> 2)) % 2 === 0;
    const strand = (horizontal ? y : x) % 4;
    const shade = 98 + strand * 10 + (horizontal ? 8 : 0);
    const offset = (y * 64 + x) * 4;
    pixels[offset] = shade; pixels[offset + 1] = shade; pixels[offset + 2] = shade; pixels[offset + 3] = 255;
  }
  const weave = new THREE.DataTexture(pixels, 64, 64, THREE.RGBAFormat);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(5, 5); weave.colorSpace = THREE.SRGBColorSpace; weave.needsUpdate = true;
  weave.magFilter = THREE.LinearFilter; weave.minFilter = THREE.LinearMipmapLinearFilter; weave.generateMipmaps = true;
  weave.name = 'Generated carbon fibre weave'; textures.add(weave);
  const carbon = ownMaterial(new THREE.MeshStandardMaterial({ color: '#3c4248', map: weave, metalness: 0.12, roughness: 0.53 }));
  const edge = ownMaterial(new THREE.MeshStandardMaterial({ color: '#191e23', metalness: 0.2, roughness: 0.5 }));
  const rubber = ownMaterial(new THREE.MeshStandardMaterial({ color: '#191b1f', roughness: 0.85 }));
  const pack = ownMaterial(new THREE.MeshStandardMaterial({ color: '#292d32', metalness: 0.12, roughness: 0.49 }));
  const accent = ownMaterial(new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.66, metalness: 0.04 }));
  const anodized = ownMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color).multiplyScalar(0.64), roughness: 0.32, metalness: 0.78 }));
  const aluminium = ownMaterial(new THREE.MeshStandardMaterial({ color: '#a6afb4', metalness: 0.86, roughness: 0.28 }));
  const copper = ownMaterial(new THREE.MeshStandardMaterial({ color: '#aa6338', metalness: 0.72, roughness: 0.38 }));
  const pcb = ownMaterial(new THREE.MeshStandardMaterial({ color: '#25413c', roughness: 0.63, metalness: 0.12 }));
  const wireRed = ownMaterial(new THREE.MeshStandardMaterial({ color: '#9b3e32', roughness: 0.62 }));
  const glass = ownMaterial(new THREE.MeshStandardMaterial({ color: '#182c39', metalness: 0.68, roughness: 0.12 }));
  const fairing = ownMaterial(new THREE.MeshStandardMaterial({ color: spec.color, metalness: 0.18, roughness: 0.4 }));
  const propMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color).multiplyScalar(cine ? 0.44 : 0.93), roughness: 0.35, metalness: 0.04, side: THREE.DoubleSide }));
  propMaterial.name = 'FPV propeller polymer';
  const frontLight = ownMaterial(new THREE.MeshStandardMaterial({ color: '#d8e3e8', emissive: '#b8dce7', emissiveIntensity: 0.9, roughness: 0.4 }));
  const backLight = ownMaterial(new THREE.MeshStandardMaterial({ color: '#8a2e24', emissive: '#ff3121', emissiveIntensity: 0.8, roughness: 0.45 }));
  const blurMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  const cube = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const rounded = ownGeometry(new RoundedBoxGeometry(1, 1, 1, 2, 0.08));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 12));
  const screw = ownGeometry(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8));

  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, name = '') => {
    const value = new THREE.Mesh(geometry, material); value.name = name;
    value.castShadow = value.receiveShadow = true; parent.add(value); return value;
  };
  const box = (parent: THREE.Object3D, material: THREE.Material, position: [number, number, number], size: [number, number, number], soft = false, name = '') => {
    const value = mesh(soft ? rounded : cube, material, parent, name); value.position.set(...position); value.scale.set(...size); return value;
  };
  const post = (parent: THREE.Object3D, material: THREE.Material, position: [number, number, number], radius: number, height: number) => {
    const value = mesh(cylinder, material, parent); value.position.set(...position); value.scale.set(radius, height, radius); return value;
  };
  const tube = (parent: THREE.Object3D, material: THREE.Material, points: THREE.Vector3[], radius = 0.009) =>
    mesh(ownGeometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(4, points.length * 3), radius, 5, false)), material, parent);
  const plate = (width: number, length: number, depth: number) => {
    const outline = new THREE.Shape();
    const corners = [[-width * 0.37, -length / 2], [width * 0.37, -length / 2], [width / 2, -length * 0.35], [width / 2, length * 0.36], [width * 0.34, length / 2], [-width * 0.34, length / 2], [-width / 2, length * 0.36], [-width / 2, -length * 0.35]];
    corners.forEach(([x, z], index) => index === 0 ? outline.moveTo(x, z) : outline.lineTo(x, z)); outline.closePath();
    // Genuine ventilation openings make the stack visible from above and below.
    for (const z of [-length * 0.2, length * 0.22]) {
      const hole = new THREE.Path(); hole.absellipse(0, z, width * 0.16, length * 0.07, 0, Math.PI * 2, true, 0); outline.holes.push(hole);
    }
    const geometry = ownGeometry(new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 8, steps: 1 }));
    geometry.rotateX(-Math.PI / 2); return geometry;
  };
  const loft = (sections: Array<[number, number, number]>, segments = 12) => {
    const positions: number[] = [], indices: number[] = [];
    for (const [z, width, height] of sections) for (let point = 0; point < segments; point++) {
      const a = point * Math.PI * 2 / segments; positions.push(Math.cos(a) * width, Math.sin(a) * height, z);
    }
    for (let section = 0; section < sections.length - 1; section++) for (let point = 0; point < segments; point++) {
      const a = section * segments + point, b = section * segments + (point + 1) % segments, c = a + segments, d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
    const front = positions.length / 3; positions.push(0, 0, sections[0][0]);
    const rear = positions.length / 3; positions.push(0, 0, sections[sections.length - 1][0]);
    for (let point = 0; point < segments; point++) {
      const next = (point + 1) % segments, last = (sections.length - 1) * segments;
      indices.push(front, next, point, rear, last + point, last + next);
    }
    const geometry = ownGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
  };

  mesh(plate(shape.width, shape.length, 0.043), carbon, frame).position.y = -0.016;
  mesh(plate(shape.width * 0.91, shape.length * (vector ? 0.72 : 0.85), 0.024), carbon, frame).position.y = 0.163;
  for (const x of [-shape.width * 0.35, shape.width * 0.35]) for (const z of [-shape.length * 0.29, shape.length * 0.28]) {
    post(frame, anodized, [x, 0.09, z], 0.018, 0.15);
    const bolt = mesh(screw, aluminium, frame); bolt.position.set(x, 0.196, z);
  }
  for (const y of [0.062, 0.111]) {
    box(electronics, pcb, [0, y, 0], [0.285, 0.022, 0.29]);
    box(electronics, edge, [0, y + 0.017, 0], [0.104, 0.016, 0.095]);
    for (const x of [-0.119, 0.119]) for (const z of [-0.116, 0.116]) post(electronics, rubber, [x, y - 0.009, z], 0.023, 0.043);
    for (let pad = 0; pad < 5; pad++) box(electronics, copper, [0.127, y + 0.014, -0.09 + pad * 0.043], [0.027, 0.007, 0.013]);
  }
  box(electronics, aluminium, [0, 0.116, shape.length * 0.29], [shape.width * 0.65, 0.045, 0.13]);
  for (let fin = 0; fin < 5; fin++) box(electronics, edge, [-0.095 + fin * 0.047, 0.15, shape.length * 0.29], [0.011, 0.019, 0.115]);

  const [batteryWidth, batteryHeight, batteryLength] = shape.battery;
  const batteryY = vector ? -0.065 : 0.198 + batteryHeight / 2;
  box(battery, rubber, [0, batteryY - batteryHeight / 2 - 0.008, 0.05], [batteryWidth + 0.016, 0.018, batteryLength], true);
  box(battery, pack, [0, batteryY, 0.05], [batteryWidth, batteryHeight, batteryLength], true);
  for (const end of [-1, 1]) box(battery, accent, [0, batteryY, 0.05 + end * batteryLength * 0.488], [batteryWidth * 0.9, batteryHeight * 0.82, 0.018], true);
  for (const z of [0.05 - batteryLength * 0.26, 0.05 + batteryLength * 0.26]) {
    box(battery, rubber, [0, batteryY + batteryHeight / 2 + 0.009, z], [batteryWidth + 0.03, 0.015, 0.072]);
    for (const side of [-1, 1]) box(battery, rubber, [side * (batteryWidth / 2 + 0.01), batteryY, z], [0.013, batteryHeight + 0.017, 0.072]);
    box(battery, accent, [batteryWidth * 0.3, batteryY + batteryHeight / 2 + 0.02, z], [0.063, 0.025, 0.085], true);
  }
  box(battery, aluminium, [0, batteryY + batteryHeight / 2 + 0.009, 0.045], [batteryWidth * 0.63, 0.005, batteryLength * 0.29]);
  const cableStart = new THREE.Vector3(batteryWidth * 0.3, batteryY, batteryLength * 0.48 + 0.05);
  for (const [offset, material] of [[-0.015, rubber], [0.015, wireRed]] as const) {
    tube(battery, material, [cableStart.clone().add(new THREE.Vector3(offset, 0, 0)), new THREE.Vector3(batteryWidth / 2 + 0.09, batteryY + 0.08, batteryLength * 0.32), new THREE.Vector3(batteryWidth / 2 + 0.065, batteryY - 0.07, batteryLength * 0.21)], 0.011);
  }
  box(battery, accent, [batteryWidth / 2 + 0.062, batteryY - 0.072, batteryLength * 0.21], [0.055, 0.05, 0.065], true);

  const cameraZ = -shape.length * 0.38;
  cameraMount.position.z = cameraZ;
  const bracketOutline = new THREE.Shape();
  bracketOutline.moveTo(-0.18, 0.025); bracketOutline.lineTo(0.14, 0.025); bracketOutline.lineTo(0.09, 0.205); bracketOutline.lineTo(-0.13, 0.23); bracketOutline.closePath();
  const bracketHole = new THREE.Path(); bracketHole.absarc(-0.005, 0.135, 0.028, 0, Math.PI * 2, true); bracketOutline.holes.push(bracketHole);
  const bracketGeometry = ownGeometry(new THREE.ExtrudeGeometry(bracketOutline, { depth: 0.021, bevelEnabled: false, steps: 1, curveSegments: 8 }));
  bracketGeometry.rotateY(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const bracket = mesh(bracketGeometry, cine ? anodized : carbon, cameraMount); bracket.position.x = side * 0.144;
    post(cameraMount, accent, [side * 0.147, 0.128, 0], 0.024, 0.021).rotation.z = Math.PI / 2;
  }
  const camera = group('Tilted FPV camera', cameraMount); camera.position.y = 0.137; camera.rotation.x = shape.tilt;
  box(camera, edge, [0, 0, 0], [0.245, 0.152, 0.138], true);
  for (const side of [-1, 1]) box(camera, accent, [side * 0.122, 0.002, 0], [0.014, 0.111, 0.1], true);
  post(camera, rubber, [0, 0, -0.104], 0.076, 0.086).rotation.x = Math.PI / 2;
  post(camera, aluminium, [0, 0, -0.145], 0.064, 0.017).rotation.x = Math.PI / 2;
  const opticalGeometry = ownGeometry(new THREE.CircleGeometry(0.057, 20));
  const opticalGlass = mesh(opticalGeometry, glass, camera); opticalGlass.position.z = -0.155; opticalGlass.rotation.y = Math.PI;
  for (const side of [-1, 1]) box(frame, frontLight, [side * shape.width * 0.32, 0.035, -shape.length * 0.43], [0.028, 0.014, 0.019]);
  box(frame, backLight, [0, 0.026, shape.length * 0.45], [0.085, 0.016, 0.019]);

  const antennaBase = shape.length * 0.37;
  if (range) {
    const stalkTop = 0.74;
    tube(aerials, rubber, [new THREE.Vector3(-0.17, 0.17, antennaBase), new THREE.Vector3(-0.22, 0.38, antennaBase + 0.09), new THREE.Vector3(-0.24, stalkTop, antennaBase + 0.16)], 0.017);
    post(aerials, accent, [-0.24, stalkTop, antennaBase + 0.16], 0.072, 0.047);
    box(aerials, accent, [0, 0.206, -shape.length * 0.26], [0.185, 0.063, 0.13], true, 'GPS receiver');
    box(aerials, aluminium, [0, 0.239, -shape.length * 0.26], [0.138, 0.005, 0.096], true);
  } else {
    tube(aerials, rubber, [new THREE.Vector3(0, 0.177, antennaBase), new THREE.Vector3(0.01, 0.276, antennaBase + 0.14), new THREE.Vector3(0.025, 0.35, antennaBase + 0.25)], 0.013);
    post(aerials, accent, [0.025, 0.35, antennaBase + 0.25], 0.042, 0.065).rotation.x = 0.45;
  }
  for (const side of [-1, 1]) {
    const endpoint = new THREE.Vector3(side * (range ? 0.37 : 0.29), 0.22, antennaBase + 0.22);
    tube(aerials, rubber, [new THREE.Vector3(side * 0.08, 0.15, antennaBase), endpoint], 0.008);
    tube(aerials, accent, [endpoint.clone().add(new THREE.Vector3(0, 0, -0.06)), endpoint.clone().add(new THREE.Vector3(0, 0, 0.06))], 0.01);
  }

  if (vector) {
    const sections: Array<[number, number, number]> = [[-0.51, 0.01, 0.018], [-0.34, 0.13, 0.06], [-0.02, 0.215, 0.09], [0.36, 0.18, 0.075], [0.57, 0.012, 0.016]];
    const shell = mesh(loft(sections, 10), fairing, body, 'VECTOR low racing canopy');
    shell.position.y = 0.147;
    // Access seam and cooling slits replace a decorative aircraft windshield.
    for (const side of [-1, 1]) {
      box(body, carbon, [side * 0.2, 0.155, 0.06], [0.006, 0.025, 0.36]);
      for (let vent = 0; vent < 4; vent++) box(body, edge, [side * 0.191, 0.207, 0.09 + vent * 0.072], [0.009, 0.019, 0.039]);
    }
  }

  const bladeGeometry = (() => {
    const positions: number[] = [], indices: number[] = [];
    const spans = 10, chords = 4;
    for (const side of [-1, 1]) for (let span = 0; span <= spans; span++) for (let chord = 0; chord <= chords; chord++) {
      const t = span / spans, u = chord / chords - 0.5;
      const width = (0.12 + Math.sin(t * Math.PI) * 0.07) * (1 - t * 0.79);
      const sweep = -0.052 * Math.sin(t * Math.PI * 0.6);
      const pitch = 0.42 - t * 0.25;
      positions.push(0.13 + t * 0.85, Math.sin(pitch) * u * width + Math.cos(u * Math.PI) * 0.007 + side * 0.0025, sweep + Math.cos(pitch) * u * width);
    }
    const layer = (spans + 1) * (chords + 1);
    for (let side = 0; side < 2; side++) for (let span = 0; span < spans; span++) for (let chord = 0; chord < chords; chord++) {
      const a = side * layer + span * (chords + 1) + chord, b = a + 1, c = a + chords + 1, d = c + 1;
      if (side === 1) indices.push(a, b, c, b, d, c); else indices.push(a, c, b, b, c, d);
    }
    for (let span = 0; span < spans; span++) for (const chord of [0, chords]) {
      const a = span * (chords + 1) + chord, b = a + chords + 1; indices.push(a, a + layer, b, b, a + layer, b + layer);
    }
    for (const span of [0, spans]) for (let chord = 0; chord < chords; chord++) {
      const a = span * (chords + 1) + chord, b = a + 1; indices.push(a, b, a + layer, b, b + layer, a + layer);
    }
    const geometry = ownGeometry(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
  })();
  const ring = (outer: number, inner: number, height: number) => {
    const outline = new THREE.Shape(); outline.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true); outline.holes.push(hole);
    const geometry = ownGeometry(new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false, curveSegments: 16 })); geometry.rotateX(-Math.PI / 2); return geometry;
  };
  const motorRing = ring(0.116, 0.08, 0.05);
  const disc = ownGeometry(new THREE.CircleGeometry(shape.radius, 32)); disc.rotateX(-Math.PI / 2);
  const duct = cine ? ring(shape.radius + 0.05, shape.radius + 0.016, 0.252) : undefined;
  const rotors: THREE.Group[] = [], blurs: THREE.Mesh[] = [], directions: number[] = [];
  for (const x of [-shape.motorX, shape.motorX]) for (const z of [-shape.motorZ, shape.motorZ]) {
    const arm = box(frame, carbon, [x / 2, 0.009, z / 2], [shape.arm, race ? 0.035 : 0.047, Math.hypot(x, z)], false);
    arm.rotation.y = Math.atan2(x, z);
    for (const offset of [-0.015, 0.015]) tube(frame, rubber, [new THREE.Vector3(x * 0.18 + offset, 0.042, z * 0.18), new THREE.Vector3(x * 0.6 + offset, 0.043, z * 0.6), new THREE.Vector3(x, 0.06, z)], 0.005);
    box(frame, accent, [x * 0.79, 0.039, z * 0.79], [shape.arm + 0.011, 0.012, 0.041]).rotation.y = arm.rotation.y;
    // Short TPU motor pads sit directly against the arm, replacing tall landing stalks.
    box(frame, accent, [x, -0.041, z], [0.16, 0.049, 0.16], true, 'Low TPU landing pad');
    post(frame, aluminium, [x, 0.037, z], 0.113 * shape.motor, 0.024);
    for (let winding = 0; winding < 9; winding++) {
      const a = winding * Math.PI * 2 / 9;
      const coil = box(frame, copper, [x + Math.cos(a) * 0.076 * shape.motor, 0.081, z + Math.sin(a) * 0.076 * shape.motor], [0.027 * shape.motor, 0.045, 0.031 * shape.motor], true);
      coil.rotation.y = -a;
    }
    if (duct) {
      const guard = mesh(duct, accent, body, 'Protective propeller duct'); guard.position.set(x, -0.027, z); guard.userData.ductInnerRadius = shape.radius + 0.016;
      // Keep guard meshes separate for actual clearance inspection.
      guard.userData.keepSeparate = true;
      for (let spoke = 0; spoke < 3; spoke++) {
        const a = spoke * Math.PI * 2 / 3;
        const support = box(frame, carbon, [x + Math.cos(a) * shape.radius * 0.5, 0.025, z + Math.sin(a) * shape.radius * 0.5], [0.025, 0.027, shape.radius]); support.rotation.y = Math.PI / 2 - a;
      }
    }
    const rotor = group('Brushless motor and twisted propeller', model); rotor.position.set(x, 0.106, z);
    const bell = mesh(motorRing, anodized, rotor); bell.scale.setScalar(shape.motor);
    post(rotor, aluminium, [0, 0.049 * shape.motor, 0], 0.048 * shape.motor, 0.028);
    for (let spoke = 0; spoke < 6; spoke++) {
      const a = spoke * Math.PI / 3;
      const strut = box(rotor, anodized, [Math.cos(a) * 0.065 * shape.motor, 0.057 * shape.motor, Math.sin(a) * 0.065 * shape.motor], [0.074 * shape.motor, 0.014, 0.023]); strut.rotation.y = -a;
    }
    const blades = group('Thin swept propeller blades', rotor); blades.position.y = 0.092 * shape.motor;
    for (let index = 0; index < shape.blades; index++) {
      const blade = mesh(bladeGeometry, propMaterial, blades); blade.rotation.y = index * Math.PI * 2 / shape.blades; blade.scale.setScalar(shape.radius);
    }
    post(rotor, propMaterial, [0, 0.095 * shape.motor, 0], 0.067, 0.021);
    post(rotor, aluminium, [0, 0.112 * shape.motor, 0], 0.028, 0.025);
    const blur = mesh(disc, blurMaterial, model); blur.position.set(x, rotor.position.y + blades.position.y + 0.006, z); blur.castShadow = blur.receiveShadow = false; blur.visible = false;
    rotors.push(rotor); blurs.push(blur); directions.push(Math.sign(x * z));
  }
  if (cine) {
    for (const z of [-shape.motorZ, shape.motorZ]) box(frame, accent, [0, -0.011, z], [0.265, 0.039, 0.04]);
    for (const x of [-shape.motorX, shape.motorX]) box(frame, accent, [x, -0.011, 0], [0.04, 0.039, 0.245]);
  }
  if (vector) for (const side of [-1, 1]) box(frame, rubber, [side * 0.19, -0.152, 0.05], [0.043, 0.037, 0.53], true);

  // Combine fixed parts by material inside semantic assemblies. The four rotor
  // groups remain independent, so the same model works in game and hangar views.
  const batch = (assembly: THREE.Group) => {
    model.updateMatrixWorld(true);
    const inverse = assembly.matrixWorld.clone().invert();
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    assembly.traverse(part => {
      if (!(part instanceof THREE.Mesh) || part.userData.keepSeparate || Array.isArray(part.material)) return;
      const parts = byMaterial.get(part.material) ?? []; parts.push(part); byMaterial.set(part.material, parts);
    });
    for (const [material, parts] of byMaterial) {
      if (parts.length < 2) continue;
      const temporary = parts.map(part => {
        const clone = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
        clone.applyMatrix4(inverse.clone().multiply(part.matrixWorld));
        if (!clone.getAttribute('uv')) clone.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(clone.getAttribute('position').count * 2), 2));
        return clone;
      });
      const merged = mergeGeometries(temporary, false);
      for (const geometry of temporary) geometry.dispose();
      if (!merged) continue;
      const value = mesh(ownGeometry(merged), material, assembly, `${assembly.name} · ${material.type}`);
      value.userData.partNames = parts.map(part => part.name).filter(Boolean);
      for (const part of parts) part.removeFromParent();
    }
  };
  for (const assembly of [frame, electronics, battery, cameraMount, aerials, body, ...rotors]) batch(assembly);

  let lastTime: number | undefined;
  let disposed = false;
  return {
    model,
    update(time: number, flying: boolean, speed: number) {
      if (disposed) return;
      const dt = lastTime === undefined ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, 0.08); lastTime = time;
      const rotorSpeed = flying ? 64 + THREE.MathUtils.clamp(speed, 0, 100) * 0.75 : 0;
      rotors.forEach((rotor, index) => { rotor.rotation.y = (rotor.rotation.y + rotorSpeed * dt * directions[index]) % (Math.PI * 2); blurs[index].visible = flying; });
      frontLight.emissiveIntensity = flying ? 1.05 : 0.65;
      backLight.emissiveIntensity = flying ? 1.15 + Math.sin(time * 3.3) * 0.09 : 0.6;
      blurMaterial.opacity = flying ? 0.06 + Math.min(Math.max(speed, 0), 100) * 0.00035 : 0;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      model.clear(); model.removeFromParent();
    },
  };
}

/** Axial speed airframe: +Y is the nose/thrust axis, upright when hovering.
 * The five parallel fairings follow the Peregreen photographs and CAD shown at
 * https://airshaper.com/cases/peregreen-v4-fastest-drone. Dimensions and finish
 * are a game interpretation; this is not a construction model of the aircraft.
 */
function createFalconDrone() {
  const spec = getDroneSpec('falcon');
  const model = new THREE.Group();
  model.name = `AEROFLOW ${spec.name}`;
  model.userData.droneId = spec.id;
  model.userData.frame = spec.frame;
  model.userData.longitudinalAxis = '+Y';
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const ownGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const ownMaterial = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const graphite = ownMaterial(new THREE.MeshStandardMaterial({ color: '#20252a', roughness: 0.58, metalness: 0.12 }));
  const carbon = ownMaterial(new THREE.MeshStandardMaterial({ color: '#101519', roughness: 0.45, metalness: 0.22 }));
  const gold = ownMaterial(new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.38, metalness: 0.46 }));
  const metal = ownMaterial(new THREE.MeshStandardMaterial({ color: '#777f85', roughness: 0.3, metalness: 0.82 }));
  const lens = ownMaterial(new THREE.MeshStandardMaterial({ color: '#183d52', roughness: 0.09, metalness: 0.65 }));
  const propMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: '#22282c', roughness: 0.43, metalness: 0.1, side: THREE.DoubleSide }));
  propMaterial.name = 'FPV propeller polymer';
  const blurMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: '#bec7cb', opacity: 0.08, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const rearLight = ownMaterial(new THREE.MeshStandardMaterial({ color: '#9b3928', emissive: '#ee3720', emissiveIntensity: 0.65, roughness: 0.4 }));
  const cube = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 16));
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = model, name = '') => {
    const part = new THREE.Mesh(geometry, material); part.name = name;
    part.castShadow = part.receiveShadow = true; parent.add(part); return part;
  };
  const box = (position: [number, number, number], size: [number, number, number], material: THREE.Material, name = '') => {
    const part = mesh(cube, material, model, name); part.position.set(...position); part.scale.set(...size); return part;
  };
  const lathe = (profile: Array<[number, number]>, segments = 24) =>
    ownGeometry(new THREE.LatheGeometry(profile.map(([radius, y]) => new THREE.Vector2(radius, y)), segments));

  // A long battery/electronics capsule, parallel to all four motor axes.
  const centralProfile: Array<[number, number]> = [
    [0.012, -1.50], [0.055, -1.36], [0.116, -1.14], [0.195, -0.85],
    [0.25, -0.42], [0.268, 0.08], [0.26, 0.55], [0.229, 0.90],
    [0.165, 1.17], [0.088, 1.38], [0.044, 1.48],
  ];
  const fuselage = mesh(lathe(centralProfile, 32), gold, model, 'FALCON axial fuselage');
  fuselage.userData.axis = '+Y';
  mesh(lathe([[0.253, -0.41], [0.271, 0.08], [0.266, 0.32]], 32), graphite, model, 'FALCON central equipment band');
  mesh(lathe([[0.015, -1.50], [0.058, -1.36], [0.10, -1.22]], 24), graphite, model, 'FALCON tapered tail');
  // Small body seams make the shell readable without adding a cockpit or wings.
  for (const [radius, y] of [[0.253, -0.43], [0.264, 0.56]] as const) {
    const seam = mesh(ownGeometry(new THREE.TorusGeometry(radius, 0.004, 4, 32)), carbon);
    seam.rotation.x = Math.PI / 2; seam.position.y = y;
  }
  const camera = new THREE.Group(); camera.name = 'Axial FPV camera'; camera.position.y = 1.479; camera.rotation.x = Math.PI / 2; model.add(camera);
  const bezel = mesh(cylinder, graphite, camera); bezel.rotation.x = Math.PI / 2; bezel.scale.set(0.047, 0.025, 0.047);
  const glass = mesh(ownGeometry(new THREE.CircleGeometry(0.034, 20)), lens, camera);
  glass.position.z = -0.015; glass.rotation.y = Math.PI;

  const motorOffset = 0.82;
  const propRadius = 0.57;
  const podGeometry = lathe([
    [0.097, -0.535], [0.135, -0.37], [0.15, -0.10], [0.139, 0.27],
    [0.105, 0.57], [0.053, 0.79], [0.011, 0.91],
  ], 24);
  const podNose = lathe([[0.108, 0.568], [0.056, 0.79], [0.013, 0.91]], 24);
  const motorGeometry = ownGeometry(new THREE.CylinderGeometry(0.094, 0.094, 0.087, 20));
  const spinnerGeometry = lathe([[0.006, -0.405], [0.026, -0.32], [0.06, -0.19], [0.087, -0.048], [0.087, -0.018]], 20);
  // Slim, pitched two-blade rotors stay perpendicular to the capsule axis.
  const bladePositions: number[] = [], bladeIndices: number[] = [];
  const spans = 10, chords = 4;
  for (const side of [-1, 1]) for (let span = 0; span <= spans; span++) for (let chord = 0; chord <= chords; chord++) {
    const t = span / spans, u = chord / chords - 0.5;
    const width = (0.12 + Math.sin(t * Math.PI) * 0.06) * (1 - t * 0.76);
    const pitch = 0.42 - t * 0.25;
    bladePositions.push((0.14 + t * 0.84) * propRadius, (Math.sin(pitch) * u * width + Math.cos(u * Math.PI) * 0.007 + side * 0.0025) * propRadius,
      (-0.035 * Math.sin(t * Math.PI * 0.6) + Math.cos(pitch) * u * width) * propRadius);
  }
  const layer = (spans + 1) * (chords + 1);
  for (let side = 0; side < 2; side++) for (let span = 0; span < spans; span++) for (let chord = 0; chord < chords; chord++) {
    const a = side * layer + span * (chords + 1) + chord, b = a + 1, c = a + chords + 1, d = c + 1;
    if (side === 1) bladeIndices.push(a, b, c, b, d, c); else bladeIndices.push(a, c, b, b, c, d);
  }
  for (let span = 0; span < spans; span++) for (const chord of [0, chords]) {
    const a = span * (chords + 1) + chord, b = a + chords + 1; bladeIndices.push(a, a + layer, b, b, a + layer, b + layer);
  }
  for (const span of [0, spans]) for (let chord = 0; chord < chords; chord++) {
    const a = span * (chords + 1) + chord, b = a + 1; bladeIndices.push(a, b, a + layer, b, b + layer, a + layer);
  }
  const bladeGeometry = ownGeometry(new THREE.BufferGeometry());
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladePositions, 3)); bladeGeometry.setIndex(bladeIndices); bladeGeometry.computeVertexNormals();
  const discGeometry = ownGeometry(new THREE.CircleGeometry(propRadius, 48)); discGeometry.rotateX(-Math.PI / 2);
  const rotors: THREE.Group[] = [], blurs: THREE.Mesh[] = [], directions: number[] = [];
  for (const x of [-motorOffset, motorOffset]) for (const z of [-motorOffset, motorOffset]) {
    const length = Math.hypot(x, z);
    const arm = box([x * 0.5, -0.12, z * 0.5], [0.095, 0.14, length], carbon, 'FALCON narrow X strut'); arm.rotation.y = Math.atan2(x, z);
    const marking = box([x * 0.69, -0.044, z * 0.69], [0.1, 0.006, 0.12], gold); marking.rotation.y = arm.rotation.y;
    const pod = mesh(podGeometry, graphite, model, 'FALCON axial motor pod'); pod.position.set(x, 0, z); pod.userData.axis = '+Y';
    const nose = mesh(podNose, gold, model, 'FALCON motor nose'); nose.position.set(x, 0, z);
    const motor = mesh(motorGeometry, metal); motor.position.set(x, -0.552, z);
    const rotor = new THREE.Group(); rotor.name = 'Brushless motor and twisted propeller'; rotor.position.set(x, -0.615, z); model.add(rotor);
    const blades = new THREE.Group(); blades.name = 'Thin swept propeller blades'; rotor.add(blades);
    for (let index = 0; index < 2; index++) mesh(bladeGeometry, propMaterial, blades).rotation.y = index * Math.PI;
    const hub = mesh(cylinder, metal, rotor); hub.scale.set(0.085, 0.036, 0.085);
    mesh(spinnerGeometry, gold, rotor, 'FALCON axial propeller spinner');
    const blur = mesh(discGeometry, blurMaterial); blur.position.set(x, -0.613, z); blur.castShadow = blur.receiveShadow = false; blur.visible = false;
    rotors.push(rotor); blurs.push(blur); directions.push(Math.sign(x * z));
  }
  // A rear status light is a small LED, not an exhaust flame.
  const status = mesh(ownGeometry(new THREE.SphereGeometry(0.014, 8, 6)), rearLight); status.position.set(0, -1.17, -0.108);
  let previousTime: number | undefined;
  let disposed = false;
  return {
    model,
    update(time: number, flying: boolean, speed: number) {
      if (disposed) return;
      const dt = previousTime === undefined ? 0 : THREE.MathUtils.clamp(time - previousTime, 0, 0.08); previousTime = time;
      const angularSpeed = flying ? 64 + THREE.MathUtils.clamp(speed, 0, 100) * 0.75 : 0;
      rotors.forEach((rotor, index) => { rotor.rotation.y = (rotor.rotation.y + angularSpeed * dt * directions[index]) % (Math.PI * 2); blurs[index].visible = flying; });
      blurMaterial.opacity = flying ? 0.06 + Math.min(Math.max(speed, 0), 100) * 0.00035 : 0;
      rearLight.emissiveIntensity = flying ? 1.0 + Math.sin(time * 3.3) * 0.09 : 0.65;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      model.clear(); model.removeFromParent();
    },
  };
}
