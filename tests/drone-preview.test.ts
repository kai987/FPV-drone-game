import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DRONES } from '../src/game/drone-catalog.ts';
import { createDrone } from '../src/game/drone.ts';
import { fitDroneCamera } from '../src/components/drone-preview-stage.ts';

function eachCorner(bounds: THREE.Box3, visit: (corner: THREE.Vector3) => void) {
  const point = new THREE.Vector3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) visit(point.set(x, y, z));
}

test('all six game models fit completely in thumbnail, desktop and narrow mobile cameras', () => {
  for (const spec of DRONES) {
    const drone = createDrone(spec.id);
    try {
      drone.update(0, false, 0);
      const bounds = new THREE.Box3().setFromObject(drone.model);
      for (const aspect of [420 / 280, 470 / 270, 248 / 235]) {
        const camera = new THREE.PerspectiveCamera(32, aspect);
        fitDroneCamera(camera, drone.model);
        eachCorner(bounds, point => {
          const projected = point.clone().project(camera);
          assert.ok(Math.abs(projected.x) <= 0.91 && Math.abs(projected.y) <= 0.91, `${spec.id} must fit with a margin at aspect ${aspect}`);
          assert.ok(projected.z > -1 && projected.z < 1, `${spec.id} must stay between the clipping planes`);
        });
      }
    } finally { drone.dispose(); }
  }
});

test('zoom and orbit cannot slice the model with either camera clipping plane', () => {
  for (const spec of DRONES) {
    const drone = createDrone(spec.id);
    try {
      const bounds = new THREE.Box3().setFromObject(drone.model);
      const camera = new THREE.PerspectiveCamera(32, 248 / 235);
      const { center, distance } = fitDroneCamera(camera, drone.model);
      const direction = camera.position.clone().sub(center).normalize();
      for (const zoom of [0.60, 1, 2.2]) for (const rotation of [0, Math.PI / 2, Math.PI]) {
        const view = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
        camera.position.copy(center).addScaledVector(view, distance * zoom);
        camera.lookAt(center); camera.updateMatrixWorld(true);
        eachCorner(bounds, point => {
          const projected = point.clone().project(camera);
          assert.ok(projected.z > -1 && projected.z < 1, `${spec.id} clipping at zoom ${zoom}, orbit ${rotation}`);
        });
      }
    } finally { drone.dispose(); }
  }
});
