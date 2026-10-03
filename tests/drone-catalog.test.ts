import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DEFAULT_DRONE_ID, DRONE_CATALOG_NOTE, DRONES, FLIGHT_BOOST_MULTIPLIER, getDroneSpec, getFlightConfig } from '../src/game/drone-catalog.ts';
import type { DroneId, DroneFlightMode } from '../src/game/drone-catalog.ts';
import { createDrone } from '../src/game/drone.ts';
import { createFlightState, stepFlight } from '../src/game/flight.ts';
import type { FlightInput, FlightState } from '../src/game/flight.ts';

const idle: FlightInput = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
const forward: FlightInput = { ...idle, forward: 1 };
const flatGround = () => 0;
const modes: DroneFlightMode[] = ['assisted', 'sport'];

function simulate(id: DroneId, mode: DroneFlightMode, input: FlightInput, seconds: number, state = createFlightState()): FlightState {
  const profile = getDroneSpec(id).flight;
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) stepFlight(state, input, 1 / 60, mode, flatGround, profile);
  return state;
}

test('four fictional catalogue entries have distinct frames and retain freestyle as the default', () => {
  assert.deepEqual(DRONES.map(drone => drone.id), ['cinewhoop', 'freestyle', 'racer', 'explorer']);
  assert.equal(new Set(DRONES.map(drone => drone.frame)).size, 4);
  assert.equal(DEFAULT_DRONE_ID, 'freestyle');
  assert.equal(getDroneSpec('unknown').id, DEFAULT_DRONE_ID);
  assert.match(DRONE_CATALOG_NOTE, /虚构游戏机型/);
  assert.match(DRONE_CATALOG_NOTE, /不代表真实产品实测/);
  for (const spec of DRONES) {
    assert.ok(spec.wheelbaseMm > 0 && spec.propellerInches > 0 && spec.weightGrams > 0 && spec.enduranceMinutes > 0);
    for (const label of [spec.name, spec.description, spec.battery, spec.motors, spec.lens, spec.videoLink]) assert.ok(label.length > 0);
    assert.ok(Object.values(spec.flight).every(value => Number.isFinite(value) && value > 0));
  }
});

test('hangar speeds and climb rates match the actual ordinary simulation in both modes', () => {
  for (const spec of DRONES) for (const mode of modes) {
    const config = getFlightConfig(spec.id, mode);
    const cruising = simulate(spec.id, mode, forward, 10);
    const climbing = simulate(spec.id, mode, { ...idle, climb: 1 }, 10);
    assert.ok(Math.abs(-cruising.velocity.z - config.speed) < 1e-7, `${spec.id}/${mode} forward speed`);
    assert.ok(Math.abs(climbing.velocity.y - config.climbSpeed) < 1e-7, `${spec.id}/${mode} climb speed`);
    assert.equal(cruising.position.y, 12);
    assert.equal(cruising.collision, false);
    assert.equal(config.initialAcceleration, config.speed * config.response);
    assert.equal(config.responseTime, 1 / config.response);
    assert.ok(getFlightConfig(spec.id, 'sport').speed > getFlightConfig(spec.id, 'assisted').speed);
  }
  assert.equal(getFlightConfig('freestyle', 'assisted').speed, 20);
  assert.equal(getFlightConfig('freestyle', 'sport').speed, 34);
});

test('boost is opt-in and diagonal controls obey the selected model speed ceiling', () => {
  for (const spec of DRONES) for (const mode of modes) {
    const ordinary = getFlightConfig(spec.id, mode);
    const boost = getFlightConfig(spec.id, mode, true);
    const boosted = simulate(spec.id, mode, { ...forward, boost: true }, 10);
    const diagonal = simulate(spec.id, mode, { ...forward, strafe: 1, climb: 1 }, 10);
    assert.equal(boost.speed, ordinary.speed * FLIGHT_BOOST_MULTIPLIER);
    assert.equal(boost.climbSpeed, ordinary.climbSpeed);
    assert.ok(Math.abs(-boosted.velocity.z - boost.speed) < 1e-7);
    assert.ok(Math.hypot(diagonal.velocity.x, diagonal.velocity.y, diagonal.velocity.z) <= ordinary.speed + 1e-9);
  }
});

test('omitting the new profile preserves the previous default flight behavior', () => {
  const original = createFlightState();
  const explicit = createFlightState();
  for (let frame = 0; frame < 300; frame++) {
    const input = {
      forward: frame < 120 ? 1 : 0, strafe: frame > 80 && frame < 180 ? 0.4 : 0,
      climb: frame > 180 && frame < 220 ? 0.6 : 0, yaw: frame > 40 && frame < 80 ? 0.3 : 0,
      lookPitch: frame > 20 && frame < 40 ? 0.2 : 0,
    };
    const mode = frame > 150 ? 'sport' : 'assisted';
    stepFlight(original, input, 1 / 60, mode, flatGround);
    stepFlight(explicit, input, 1 / 60, mode, flatGround, getDroneSpec('freestyle').flight);
  }
  assert.deepEqual(original, explicit);
});

test('selected profiles change normalized acceleration, braking, yaw and bank', () => {
  for (const mode of modes) {
    const responseRatio = (id: DroneId) => -simulate(id, mode, forward, 0.2).velocity.z / getFlightConfig(id, mode).speed;
    assert.ok(responseRatio('racer') > responseRatio('freestyle'));
    assert.ok(responseRatio('cinewhoop') > responseRatio('freestyle'));
    assert.ok(responseRatio('explorer') < responseRatio('freestyle'));
    const brakeRatio = (id: DroneId) => {
      const state = simulate(id, mode, forward, 10);
      const initialSpeed = -state.velocity.z;
      simulate(id, mode, idle, 0.4, state);
      return -state.velocity.z / initialSpeed;
    };
    assert.ok(brakeRatio('cinewhoop') < brakeRatio('freestyle'));
    assert.ok(brakeRatio('explorer') > brakeRatio('freestyle'));
    assert.ok(brakeRatio('racer') > brakeRatio('freestyle'));
    const yaw = (id: DroneId) => simulate(id, mode, { ...idle, yaw: 1 }, 0.5).yaw;
    assert.ok(yaw('racer') > yaw('freestyle'));
    assert.ok(yaw('cinewhoop') < yaw('freestyle'));
    assert.ok(yaw('explorer') < yaw('cinewhoop'));
    for (const spec of DRONES) {
      assert.ok(Math.abs(yaw(spec.id) - getFlightConfig(spec.id, mode).yawSpeed * 0.5) < 1e-10);
      const banking = simulate(spec.id, mode, { ...idle, strafe: 1 }, 3);
      assert.ok(Math.abs(banking.roll + getFlightConfig(spec.id, mode).bank * 0.8) < 1e-8);
    }
  }
});

test('four rendered airframes have distinct silhouettes and only cinewhoop has four hollow ducts', () => {
  const sizes = new Map<DroneId, THREE.Vector3>();
  for (const spec of DRONES) {
    const drone = createDrone(spec.id);
    assert.equal(drone.model.userData.droneId, spec.id);
    assert.equal(drone.model.userData.frame, spec.frame);
    const guards: THREE.Object3D[] = [];
    drone.model.traverse(part => { if (part.name === 'Protective propeller duct') guards.push(part); });
    assert.equal(guards.length, spec.id === 'cinewhoop' ? 4 : 0);
    for (const guard of guards) {
      const geometry = (guard as THREE.Mesh).geometry as THREE.ExtrudeGeometry;
      const shape = geometry.parameters.shapes as THREE.Shape;
      assert.equal(shape.holes.length, 1);
    }
    sizes.set(spec.id, new THREE.Box3().setFromObject(drone.model).getSize(new THREE.Vector3()));
    drone.dispose();
  }
  const cine = sizes.get('cinewhoop')!;
  const standard = sizes.get('freestyle')!;
  const race = sizes.get('racer')!;
  const explorer = sizes.get('explorer')!;
  assert.ok(cine.x < standard.x && cine.z < standard.z);
  assert.ok(race.z / race.x > standard.z / standard.x);
  assert.ok(explorer.x > standard.x && explorer.z > standard.z && explorer.y > standard.y);
});

test('switching models can release every shared part once without disposing another model', () => {
  const scene = new THREE.Scene();
  const models = DRONES.map(spec => createDrone(spec.id));
  const resourceSets = models.map(drone => {
    scene.add(drone.model);
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    drone.model.traverse(part => {
      if (!(part instanceof THREE.Mesh)) return;
      resources.add(part.geometry);
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) resources.add(material);
    });
    return resources;
  });
  const disposals = new Map<THREE.BufferGeometry | THREE.Material, number>();
  for (const resources of resourceSets) for (const resource of resources) {
    assert.equal(disposals.has(resource), false, 'independent models must own independent GPU resources');
    disposals.set(resource, 0);
    resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource)! + 1));
  }
  models.forEach((drone, index) => {
    drone.dispose();
    drone.dispose();
    drone.update(1, true, 30);
    assert.equal(drone.model.parent, null);
    assert.equal(drone.model.children.length, 0);
    for (const resource of resourceSets[index]) assert.equal(disposals.get(resource), 1);
    for (const resources of resourceSets.slice(index + 1)) for (const resource of resources) assert.equal(disposals.get(resource), 0);
    for (const other of models.slice(index + 1)) assert.ok(other.model.children.length > 0);
  });
  assert.equal(scene.children.length, 0);
});
