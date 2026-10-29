import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MOUNTAIN_PEAKS, MOUNTAIN_RIDGES, explorationGroundHeight } from '../src/game/exploration-layout.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));

test('alpine summits have a narrow crown and remain flyable beneath the altitude ceiling', () => {
  const world = createWorldKernel(createRustRuntime(module), 'mountains');
  try {
    for (const peak of MOUNTAIN_PEAKS) {
      const summit = world.groundHeight(peak.x, peak.z);
      assert.ok(summit > 450 && summit < 780, 'summits retain room beneath the 800 m flight limit');
      for (const [dx, dz] of [[80, 0], [-80, 0], [0, 80], [0, -80]]) {
        const flank = world.groundHeight(peak.x + dx, peak.z + dz);
        assert.ok(summit - flank > 70, `the summit at ${peak.x}/${peak.z} must have a visible shoulder, not a rounded dome`);
        assert.ok(Math.abs(flank - explorationGroundHeight('mountains', peak.x + dx, peak.z + dz)) < 1e-8);
      }
    }
  } finally { world.dispose(); }
});

test('rock faces have substantial slopes above 45 degrees while the envelope stays bounded', () => {
  const world = createWorldKernel(createRustRuntime(module), 'mountains');
  let raised = 0, steep = 0, cliff = 0, maximum = -Infinity;
  try {
    for (let x = -2400; x <= 2400; x += 40) for (let z = -2400; z <= 2400; z += 40) {
      const y = world.groundHeight(x, z);
      assert.ok(Number.isFinite(y) && y > -2);
      maximum = Math.max(maximum, y);
      if (y <= 80) continue;
      raised++;
      const dx = (world.groundHeight(x + 2, z) - world.groundHeight(x - 2, z)) / 4;
      const dz = (world.groundHeight(x, z + 2) - world.groundHeight(x, z - 2)) / 4;
      const slope = Math.hypot(dx, dz);
      if (slope > 1) steep++;
      if (slope > 1.7) cliff++;
    }
    assert.ok(raised > 1000, 'the cliff landscape covers real flying space');
    assert.ok(steep / raised > 0.35, 'steep rock faces occupy substantially more high terrain than the old rounded hills');
    assert.ok(cliff > 100, 'there are meaningful, near-60-degree rock faces');
    assert.ok(maximum > 700 && maximum < 780);
  } finally { world.dispose(); }
});

test('connected ridgelines bend through irregular saddles and secondary summits rather than straight walls', () => {
  const world = createWorldKernel(createRustRuntime(module), 'mountains');
  try {
    for (const ridge of MOUNTAIN_RIDGES) {
      const dx = ridge.bx - ridge.ax, dz = ridge.bz - ridge.az, length = Math.hypot(dx, dz);
      const crest: number[] = [], offsets: number[] = [];
      for (let sample = 2; sample <= 18; sample++) {
        const t = sample / 20, x = ridge.ax + t * dx, z = ridge.az + t * dz;
        let maximum = -Infinity, offset = 0;
        for (let across = -140; across <= 140; across += 10) {
          const y = world.groundHeight(x - dz / length * across, z + dx / length * across);
          if (y > maximum) { maximum = y; offset = across; }
        }
        crest.push(maximum); offsets.push(offset);
      }
      assert.ok(Math.min(...crest) > 120, 'adjacent peaks connect through real, traversable rock saddles');
      assert.ok(Math.max(...crest) - Math.min(...crest) > 100, 'ridgelines rise and fall rather than form a level wall');
      assert.ok(Math.max(...offsets) - Math.min(...offsets) > 50, 'the crest meanders away from the straight endpoint chord');
      let turns = 0;
      for (let i = 1; i < crest.length - 1; i++) if ((crest[i] - crest[i - 1]) * (crest[i + 1] - crest[i]) < 0) turns++;
      assert.ok(turns >= 3, 'a ridge contains multiple distinct secondary crests and saddles');
    }
    assert.ok(world.groundHeight(0, 80) < 35, 'the original launch valley remains a low, open space');
  } finally { world.dispose(); }
});

test('mountain flanks include metre-scaled erosion and buttresses rather than smooth cone faces', () => {
  const world = createWorldKernel(createRustRuntime(module), 'mountains');
  try {
    let brokenFaces = 0;
    for (const peak of MOUNTAIN_PEAKS.slice(0, 3)) for (const [dx, dz] of [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2]]) {
      const samples: number[] = [];
      for (let radius = 110; radius <= 350; radius += 20)
        samples.push(world.groundHeight(peak.x + dx * radius, peak.z + dz * radius));
      const curvature = samples.slice(1, -1).map((height, i) => Math.abs(samples[i] - 2 * height + samples[i + 2]));
      if (Math.max(...curvature) > 4 && curvature.reduce((sum, value) => sum + value, 0) > 15) brokenFaces++;
    }
    assert.ok(brokenFaces >= 6, 'erosion changes the shape of multiple distinct rock faces at 20–200 m scales');
  } finally { world.dispose(); }
});
