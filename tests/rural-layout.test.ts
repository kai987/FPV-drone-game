import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CHECKPOINTS } from '../src/game/world.ts';
import { TARGETS } from '../src/game/weapons.ts';
import { groundHeight, isWater, WATER_LEVEL } from '../src/game/landscape.ts';
import { createRural } from '../src/game/rural.ts';
import {
  BRIDGES, CABINS, FISH_SCHOOLS, PASTURES, bridgeDeckY, bridgePoint, bridgeSurfaceHeight,
  clearance, ruralSurfaceHeight,
} from '../src/game/rural-layout.ts';

function segmentDistance(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x; const dz = b.z - a.z;
  const fraction = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - dx * fraction, z - a.z - dz * fraction);
}

test('cabins and the complete livestock clearings stay dry and clear of the race and targets', () => {
  const areas = [
    ...CABINS.map(house => ({ x: house.x, z: house.z, radius: Math.hypot(house.width + 0.9, house.depth + 0.9) / 2 })),
    ...PASTURES.map(pasture => ({ x: pasture.x, z: pasture.z, radius: pasture.radius + 0.9 })),
  ];
  for (const area of areas) {
    assert.equal(clearance(area.x, area.z), false);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
      const x = area.x + Math.cos(angle) * area.radius;
      const z = area.z + Math.sin(angle) * area.radius;
      assert.equal(isWater(x, z), false);
      assert.ok(groundHeight(x, z) > WATER_LEVEL);
    }
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      const a = CHECKPOINTS[i].position;
      const b = CHECKPOINTS[(i + 1) % CHECKPOINTS.length].position;
      assert.ok(segmentDistance(area.x, area.z, a, b) - area.radius >= 20, 'Rural objects must not encroach on the original course');
    }
    for (const target of TARGETS) {
      assert.ok(Math.hypot(area.x - target.position.x, area.z - target.position.z) - area.radius - target.radius >= 20);
    }
  }
  assert.equal(clearance(700, 600), true);
  assert.equal(clearance(CABINS[0].x + CABINS[0].width, CABINS[0].z, 5), false);
});

test('the bridge crosses real water, reaches both dry banks and joins its ramps without a height jump', () => {
  for (const bridge of BRIDGES) {
    assert.equal(isWater(bridge.x, bridge.z), true);
    assert.ok(bridge.deckY >= WATER_LEVEL + 6);
    for (const landing of [bridge.landingA, bridge.landingB]) {
      assert.equal(isWater(landing.x, landing.z), false);
      assert.ok(Math.abs(landing.y - groundHeight(landing.x, landing.z) - 0.2) < 1e-9);
      assert.ok(Math.abs(bridgeSurfaceHeight(landing.x, landing.z)! - landing.y) < 1e-8);
    }
    for (const side of [-1, 1]) {
      const join = bridgePoint(bridge, side * bridge.span / 2);
      assert.equal(isWater(join.x, join.z), false);
      assert.ok(Math.abs(bridgeSurfaceHeight(join.x, join.z)! - bridge.deckY) < 1e-8);
      assert.ok(Math.abs(bridgeDeckY(bridge, side * bridge.span / 2 + 0.001) - bridge.deckY) < 0.001);
    }
    const outside = bridgePoint(bridge, 0, bridge.width / 2 + 0.1);
    assert.equal(bridgeSurfaceHeight(outside.x, outside.z), null);
    assert.equal(clearance(bridge.x, bridge.z), false);
  }
});

test('roof support follows the pitched roof rather than using the ridge for the whole footprint', () => {
  for (const house of CABINS) {
    const center = ruralSurfaceHeight(house.x, house.z)!;
    assert.ok(Math.abs(center - house.baseY - house.wallHeight - house.roofHeight - 0.08) < 1e-8);
    const x = house.x + Math.cos(house.yaw) * house.width * 0.4;
    const z = house.z - Math.sin(house.yaw) * house.width * 0.4;
    assert.ok(ruralSurfaceHeight(x, z)! < center - 1);
  }
});

test('fish school paths and spread remain under water and safely above the bed', () => {
  for (const school of FISH_SCHOOLS) {
    for (let i = 0; i < school.points.length; i++) {
      const a = school.points[i]; const b = school.points[(i + 1) % school.points.length];
      for (const fraction of [0, 0.25, 0.5, 0.75]) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
          const x = a.x + (b.x - a.x) * fraction + Math.cos(angle) * (school.spread + 0.8);
          const z = a.z + (b.z - a.z) * fraction + Math.sin(angle) * (school.spread + 0.8);
          assert.equal(isWater(x, z), true);
          assert.ok(groundHeight(x, z) < WATER_LEVEL - 0.55);
        }
      }
    }
  }
});

test('actual batched animal and fish animation stays inside its terrain and water clearances', () => {
  const rural = createRural();
  try {
    const bodyMeshes = rural.group.children.filter((object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh
      && object.geometry.type === 'CapsuleGeometry');
    const fishMeshes = rural.group.children.filter((object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh
      && object.geometry.type === 'LatheGeometry');
    assert.equal(bodyMeshes.reduce((sum, mesh) => sum + mesh.count, 0), 13);
    assert.equal(fishMeshes.reduce((sum, mesh) => sum + mesh.count, 0), 44);
    const matrix = new THREE.Matrix4(); const position = new THREE.Vector3();
    for (let frame = 0; frame < 96; frame++) {
      rural.update(frame * 2.0);
      for (const mesh of bodyMeshes) {
        const pasture = PASTURES.find(pasture => pasture.count === mesh.count)!;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
          assert.ok(Math.hypot(position.x - pasture.x, position.z - pasture.z) < pasture.radius - 1.5);
          assert.equal(isWater(position.x, position.z), false);
        }
      }
      for (const mesh of fishMeshes) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
          assert.equal(isWater(position.x, position.z), true);
          assert.ok(position.y <= WATER_LEVEL - 0.2);
          assert.ok(position.y - 0.14 > groundHeight(position.x, position.z));
        }
      }
    }
    for (const bridge of BRIDGES) {
      const deckObstacles = rural.obstacles.filter(obstacle => obstacle.radius === 2.3);
      assert.ok(deckObstacles.length > 30);
      for (const obstacle of deckObstacles) {
        const height = bridgeSurfaceHeight(obstacle.x, obstacle.z)!;
        assert.ok(Math.abs(obstacle.base! - height + 0.4) < 1e-8);
        assert.ok(Math.abs(groundHeight(obstacle.x, obstacle.z) + obstacle.height - height - 0.1) < 1e-8);
      }
      const below = WATER_LEVEL + 2;
      assert.equal(rural.obstacles.some(obstacle => Math.hypot(obstacle.x - bridge.x, obstacle.z - bridge.z) < obstacle.radius + 0.55
        && below > (obstacle.base ?? groundHeight(obstacle.x, obstacle.z)) - 0.45
        && below < groundHeight(obstacle.x, obstacle.z) + obstacle.height + 0.45), false);
    }
    assert.equal(rural.obstacles.filter(obstacle => obstacle.roof).length, CABINS.length);
  } finally { rural.dispose(); }
});
