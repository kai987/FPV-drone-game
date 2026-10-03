import assert from 'node:assert/strict';
import test from 'node:test';
import { BRIDGES, CABINS, bridgePoint, bridgeDeckY } from '../src/game/rural-layout.ts';
import { intersectsObstacle } from '../src/game/collisions.ts';
import { groundHeight } from '../src/game/landscape.ts';
import { flightSurfaceHeight } from '../src/game/surfaces.ts';
import { surfaceHeight } from '../src/game/landscape.ts';
import { createFlightState, stepFlight } from '../src/game/flight.ts';
import { createWeaponState, dropBomb, stepWeapons } from '../src/game/weapons.ts';

const neutral = { forward: 0, strafe: 0, climb: -1, yaw: 0 };

test('a descending aircraft settles above the actual bridge deck, while the river remains open beneath it', () => {
  const bridge = BRIDGES[0];
  const plane = createFlightState({ x: bridge.x, y: bridge.deckY + 12, z: bridge.z });
  for (let frame = 0; frame < 180; frame++) {
    const previousY = plane.position.y;
    stepFlight(plane, neutral, 1 / 60, 'assisted', (x, z) => flightSurfaceHeight(x, z, previousY));
  }
  assert.ok(plane.position.y >= bridge.deckY + 1.8 - 1e-8);
  assert.equal(flightSurfaceHeight(bridge.x, bridge.z, bridge.deckY - 1), surfaceHeight(bridge.x, bridge.z));
  const ramp = bridgePoint(bridge, bridge.span / 2 + bridge.rampLength / 2);
  assert.equal(flightSurfaceHeight(ramp.x, ramp.z, 100), bridgeDeckY(bridge, bridge.span / 2 + bridge.rampLength / 2));
});

test('game projectiles impact a bridge or cabin roof from above and reach water when released below the bridge', () => {
  const bridge = BRIDGES[0];
  const cabin = CABINS[0];
  for (const spot of [
    { x: bridge.x, z: bridge.z, y: bridge.deckY + 10, surface: bridge.deckY },
    { x: bridge.x, z: bridge.z, y: bridge.deckY - 1, surface: surfaceHeight(bridge.x, bridge.z) },
    { x: cabin.x, z: cabin.z, y: 30, surface: flightSurfaceHeight(cabin.x, cabin.z) },
  ]) {
    const state = createWeaponState();
    assert.ok(dropBomb(state, spot, { x: 0, y: 0, z: 0 }));
    stepWeapons(state, 2, flightSurfaceHeight);
    assert.equal(state.explosions.length, 1);
    assert.ok(Math.abs(state.explosions[0].position.y - spot.surface) < 1e-7);
  }
});

test('solid bridge decks stop upward passage but a sloping roof does not block empty air above its eaves', () => {
  const b = BRIDGES[0];
  const deck = { x: b.x, z: b.z, radius: 2, base: b.deckY - 0.4, height: b.deckY + 0.1 - groundHeight(b.x, b.z) };
  assert.equal(intersectsObstacle({ x: b.x, z: b.z, y: b.deckY - 1 }, deck), false);
  assert.equal(intersectsObstacle({ x: b.x, z: b.z, y: b.deckY - 0.5 }, deck), true);
  const h = CABINS[0];
  const roof = { x: h.x, z: h.z, radius: 10, height: 7, roof: true };
  const x = h.x + Math.cos(h.yaw) * h.width * 0.47;
  const z = h.z - Math.sin(h.yaw) * h.width * 0.47;
  assert.equal(intersectsObstacle({ x, z, y: flightSurfaceHeight(x, z) + 1.8 }, roof), false);
  assert.equal(intersectsObstacle({ x, z, y: h.baseY + 1 }, roof), true);
  assert.equal(intersectsObstacle({ x: h.x + 9, z: h.z, y: h.baseY + 1 }, roof), false);
});
