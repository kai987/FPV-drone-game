import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUrbanWorld } from '../../src/game/urban-world.ts';
import { getMapSpec } from '../../src/game/map-catalog.ts';
import { createRustRuntime } from '../../src/game/rust-runtime.ts';
import { createWorldKernel } from '../../src/game/world-kernel.ts';
import type { RustRuntime } from '../../src/game/rust-runtime.ts';

export const flightModule = await WebAssembly.compile(await readFile(
  new URL('../../src/game/generated/flight_core.wasm', import.meta.url)));

/** Only Canvas sign pixels are stubbed; native geography and Three.js objects are real. */
export function urbanWorldFixture(mapId: 'factory' | 'harbor') {
  const native = createRustRuntime(flightModule), calls: string[] = [];
  const runtime: RustRuntime = {
    memory: native.memory,
    call(name, ...args) { calls.push(name); return native.call(name, ...args); },
    view: native.view,
  };
  const kernel = createWorldKernel(runtime, mapId);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(name: string) {
      assert.equal(name, 'canvas');
      return { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText() {} }) };
    },
  } });
  try {
    const scenery = createUrbanWorld(runtime, kernel, getMapSpec(mapId));
    return { scenery, runtime, kernel, calls,
      dispose() { scenery.dispose(); kernel.dispose(); },
    };
  } catch (error) { kernel.dispose(); throw error; }
  finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}
