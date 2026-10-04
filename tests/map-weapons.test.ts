import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getMapSpec } from '../src/game/map-catalog.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createWeaponSimulation } from '../src/game/weapon-simulation.ts';
import { DROP_COOLDOWN } from '../src/game/weapons.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));

test('each new map scores only its own five targets and resets the complete native weapon state', () => {
  for (const mapId of ['factory', 'harbor'] as const) {
    const map = getMapSpec(mapId), runtime = createRustRuntime(module), world = createWorldKernel(runtime, mapId);
    const weapons = createWeaponSimulation(runtime, world, map.targets);
    try {
      for (const target of map.targets) {
        const { x, z } = target.position;
        const support = world.flightSurfaceHeight(x, z);
        assert.equal(support, 2, `${target.id} sits on accessible concrete`);
        assert.equal(weapons.drop({ x, y: support + 0.9, z }, { x: 0, y: 0, z: 0 }), true);
        assert.equal(weapons.step(DROP_COOLDOWN).hits, 1, `${target.id} scores once`);
      }
      assert.equal(weapons.state.score, 500);
      assert.deepEqual(weapons.state.hitTargetIds, map.targets.map(target => target.id));
      const reset = weapons.reset();
      assert.equal(reset.ammo, 6); assert.equal(reset.score, 0);
      assert.deepEqual(reset.hitTargetIds, []); assert.deepEqual(reset.bombs, []); assert.deepEqual(reset.explosions, []);
    } finally { weapons.dispose(); world.dispose(); }
  }
});
