import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const DRONE_PREVIEW_DIRECTION = new THREE.Vector3(1.08, 0.78, -1.28).normalize();

/** Fit all eight corners, including long antennas and swept propeller tips. */
export function fitDroneCamera(camera: THREE.PerspectiveCamera, model: THREE.Object3D, direction = DRONE_PREVIEW_DIRECTION) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(0.1, size.length() / 2);
  const back = direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanHorizontal = tanVertical * camera.aspect;
  const corner = new THREE.Vector3();
  let distance = radius;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    corner.set(x, y, z).sub(center);
    const depth = corner.dot(back);
    distance = Math.max(distance, Math.abs(corner.dot(right)) * 1.10 / tanHorizontal + depth, Math.abs(corner.dot(up)) * 1.10 / tanVertical + depth);
  }
  camera.position.copy(center).addScaledVector(back, distance);
  // OrbitControls permits moving closer and farther than this fitted position.
  // Keep both clipping planes outside that whole zoom budget.
  camera.near = 0.01;
  camera.far = Math.max(30, distance * 2.5 + radius * 2);
  camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return { center, radius, distance };
}

/** A transparent studio with shared physical lighting for both kinds of preview. */
export function createDroneStudio(renderer: THREE.WebGLRenderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const hemisphere = new THREE.HemisphereLight('#eef5ff', '#777b62', 1.7);
  const key = new THREE.DirectionalLight('#fff5df', 2.6); key.position.set(-3, 5, -4);
  const fill = new THREE.DirectionalLight('#d5e8ff', 1.3); fill.position.set(4, 2, -1);
  const rim = new THREE.DirectionalLight('#ffffff', 1.8); rim.position.set(-1, 3, 4);
  scene.add(hemisphere, key, fill, rim);
  // Metal and carbon keep their game materials; the studio supplies reflections.
  const environment = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  let target: THREE.WebGLRenderTarget | undefined;
  try {
    target = generator.fromScene(environment, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.65;
  } finally {
    environment.dispose(); generator.dispose();
  }
  let disposed = false;
  return {
    scene,
    dispose() {
      if (disposed) return; disposed = true;
      scene.environment = null; target?.dispose(); scene.clear();
    },
  };
}
