import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoadingMetrics } from '../src/game/loading-metrics.ts';

test('overlapping phases retain their actual start/duration instead of being added to total', () => {
  let time = 120;
  const metrics = createLoadingMetrics(100, () => time);
  const textures = metrics.measure('textures');
  time = 130; const cpu = metrics.measure('valley.cpu');
  time = 190; cpu();
  time = 250; textures();
  metrics.record('wasm', 100, 125);
  assert.deepEqual(metrics.snapshot(), { total: 150, phases: {
    'valley.cpu': { start: 30, duration: 60 },
    textures: { start: 20, duration: 130 },
    wasm: { start: 0, duration: 25 },
  } });
});
