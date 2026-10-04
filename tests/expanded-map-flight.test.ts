import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getDroneSpec } from '../src/game/drone-catalog.ts';
import { createFlightState } from '../src/game/flight.ts';
import type { FlightInput, Vec3 } from '../src/game/flight.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { WORLD_BOUNDS } from '../src/game/landscape.ts';
import { getMapSpec, URBAN_WORLD_BOUNDS } from '../src/game/map-catalog.ts';
import { HARBOR_BREAKWATERS, HARBOR_PIERS, getMapLayout } from '../src/game/map-layout.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const profile = getDroneSpec('freestyle').flight;
const calm = { strength: 'calm', direction: 0 } as const;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const axes = (forward = 0, strafe = 0, climb = 0): FlightInput => ({ forward, strafe, climb, yaw: 0 });

for (const mapId of ['factory', 'harbor'] as const) {
  test(`${mapId} real WASM flight crosses all former limits and clamps only at the enlarged boundaries`, () => {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, mapId);
    const flight = createWorldFlightSimulation(runtime, world.handle), map = getMapSpec(mapId);
    try {
      assert.deepEqual(map.bounds, URBAN_WORLD_BOUNDS);
      for (const [position, input, crossed] of [
        [{ x: 1798, y: 200, z: 100 }, axes(0, 1), (p: Vec3) => p.x > 1800],
        [{ x: -1798, y: 200, z: 100 }, axes(0, -1), (p: Vec3) => p.x < -1800],
        [{ x: 1900, y: 200, z: -2498 }, axes(1), (p: Vec3) => p.z < -2500],
        [{ x: 1900, y: 200, z: 1098 }, axes(-1), (p: Vec3) => p.z > 1100],
      ] as const) {
        const state = createFlightState(position); let clock = 0;
        for (let frame = 0; frame < 180; frame++) {
          const result = flight.step(state, input, 1 / 60, 'assisted', profile, calm, clock, map.bounds);
          clock = result.windClock;
          assert.equal(result.boundaryContact, false);
          assert.equal(result.obstacleContact, false); assert.equal(state.collision, false);
        }
        assert.ok(crossed(state.position), `did not cross old edge: ${JSON.stringify(state.position)}`);
      }
      for (const [position, input, axis, expected] of [
        [{ x: map.bounds.maxX - 0.1, y: 200, z: 100 }, axes(0, 1), 'x', map.bounds.maxX],
        [{ x: map.bounds.minX + 0.1, y: 200, z: 100 }, axes(0, -1), 'x', map.bounds.minX],
        [{ x: 1900, y: 200, z: map.bounds.minZ + 0.1 }, axes(1), 'z', map.bounds.minZ],
        [{ x: 1900, y: 200, z: map.bounds.maxZ - 0.1 }, axes(-1), 'z', map.bounds.maxZ],
        [{ x: 1900, y: map.bounds.maxAltitude - 0.1, z: 100 }, axes(0, 0, 1), 'y', map.bounds.maxAltitude],
      ] as const) {
        const state = createFlightState(position); let contact = false;
        for (let frame = 0; frame < 60; frame++) {
          const result = flight.step(state, input, 1 / 60, 'assisted', profile, calm, frame / 60, map.bounds);
          contact ||= result.boundaryContact;
          assert.equal(result.obstacleContact, false);
        }
        assert.equal(contact, true); near(state.position[axis], expected);
      }
    } finally { flight.dispose(); world.dispose(); }
  });

  test(`${mapId} new district structures outside the old bounds are solid in the native flight world`, () => {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, mapId), layout = getMapLayout(mapId);
    const flight = createWorldFlightSimulation(runtime, world.handle);
    try {
      const expanded = layout.warehouses.filter(box => Math.abs(box.x) > WORLD_BOUNDS.maxX
        || box.z < WORLD_BOUNDS.minZ || box.z > WORLD_BOUNDS.maxZ);
      assert.ok(expanded.length >= 8, 'expansion includes occupied districts beyond the former map');
      for (const building of expanded) {
        assert.equal(world.intersectsObstacle({ x: building.x, z: building.z, y: building.base + building.height / 2 }), true);
        const top = world.surfaceHeight(building.x, building.z);
        assert.ok(top >= building.base + building.height);
        near(world.flightSurfaceHeight(building.x, building.z, top + 10), top);
      }
      const building = expanded[0];
      const state = createFlightState({ x: building.x - building.width / 2 - 4,
        z: building.z, y: building.base + building.height / 2 });
      assert.equal(world.intersectsObstacle(state.position), false, 'approach starts in clear air');
      let collision = false;
      for (let frame = 0; frame < 120 && !collision; frame++) {
        const result = flight.step(state, axes(0, 1), 1 / 60, 'assisted', profile, calm, frame / 60, getMapSpec(mapId).bounds);
        collision = result.obstacleContact;
        assert.equal(result.boundaryContact, false);
      }
      assert.equal(collision, true, 'real controls collide with an expanded building and roll back');
      assert.ok(state.position.x < building.x - building.width / 2);
    } finally { flight.dispose(); world.dispose(); }
  });
}

test('valley retains its original bounds and native flight still stops at its original east edge', () => {
  assert.deepEqual(getMapSpec('valley').bounds, WORLD_BOUNDS);
  const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'valley');
  const flight = createWorldFlightSimulation(runtime, world.handle);
  const state = createFlightState({ x: 1799.9, y: 400, z: 100 }); let contact = false;
  try {
    for (let frame = 0; frame < 60; frame++) {
      const result = flight.step(state, axes(0, 1), 1 / 60, 'assisted', profile, calm, frame / 60, WORLD_BOUNDS);
      contact ||= result.boundaryContact;
    }
    assert.equal(contact, true); near(state.position.x, WORLD_BOUNDS.maxX);
  } finally { flight.dispose(); world.dispose(); }
});

test('new harbor ships, piers and breakwaters intercept native bombs at their authored deck heights', () => {
  const layout = getMapLayout('harbor');
  const surfaces = [
    ...layout.ships.slice(1).map(ship => ({ x: ship.x + ship.width / 2 - 3, z: ship.z, y: ship.deckY })),
    ...HARBOR_PIERS.slice(3).map(pier => ({ x: pier.x + pier.width / 2 - 3, z: pier.z, y: pier.base + pier.height })),
    ...HARBOR_BREAKWATERS.map(land => ({ x: land.x + land.width / 2 - 3, z: land.z, y: land.base + land.height })),
  ];
  assert.equal(layout.ships.length, 4); assert.equal(surfaces.length, 11);
  for (const surface of surfaces) {
    const runtime = createRustRuntime(module), world = createWorldKernel(runtime, 'harbor');
    const weapons = createWeaponSimulation(runtime, world);
    try {
      near(world.surfaceHeight(surface.x, surface.z), surface.y);
      assert.equal(weapons.drop({ ...surface, y: surface.y + 20 }, { x: 0, y: 0, z: 0 }), true);
      let impacts = 0;
      for (let frame = 0; frame < 600 && !impacts; frame++) impacts += weapons.step(1 / 60).impacts;
      assert.equal(impacts, 1); near(weapons.state.explosions[0].position.y, surface.y);
      if (surface.y === 2 || surface.y === 5) assert.equal(world.isWater(surface.x, surface.z), false);
    } finally { weapons.dispose(); world.dispose(); }
  }
});
