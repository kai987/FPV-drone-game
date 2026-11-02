import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MOUNTAIN_PEAKS, MOUNTAIN_RIDGES, explorationGroundHeight } from '../src/game/exploration-layout.ts';
import { ALPINE_MASSIFS } from '../src/game/alpine-massifs.ts';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));

test('massif summits are displaced and retain unequal shoulders beneath the altitude ceiling', () => {
  const world = createWorldKernel(createRustRuntime(module), 'mountains');
  try {
    for (const peak of MOUNTAIN_PEAKS) {
      let summit = { x: peak.x, z: peak.z, y: -Infinity };
      for (let x = peak.x - 550; x <= peak.x + 550; x += 10) for (let z = peak.z - 550; z <= peak.z + 550; z += 10) {
        const y = world.groundHeight(x, z);
        if (y > summit.y) summit = { x, z, y };
      }
      assert.ok(summit.y > 530 && summit.y < 780, 'all five massif regions retain real summits below the 800 m ceiling');
      assert.ok(Math.hypot(summit.x - peak.x, summit.z - peak.z) > 35, 'the summit is displaced from the old radial cone centre');
      const drops = [[80, 0], [-80, 0], [0, 80], [0, -80]].map(([dx, dz]) => {
        const flank = world.groundHeight(summit.x + dx, summit.z + dz);
        assert.ok(Math.abs(flank - explorationGroundHeight('mountains', summit.x + dx, summit.z + dz)) < 1e-8);
        return summit.y - flank;
      });
      assert.ok(Math.max(...drops) - Math.min(...drops) > 70, 'a high crest has an unequal long shoulder and an abrupt opposing face');
      assert.ok(Math.min(...drops) < 200 && Math.max(...drops) > 190, 'shoulders and cliffs coexist instead of four equally falling cone sides');
    }
  } finally { world.dispose(); }
});

test('each massif has separated prominent skyline crests instead of one triangular outline', () => {
  const world = createWorldKernel(createRustRuntime(module), 'mountains');
  try {
    for (const peak of MOUNTAIN_PEAKS) {
      const prominent: number[] = [];
      // A projected upper envelope tests what the silhouette actually contains,
      // independently of the authored crest nodes or their construction method.
      for (const axis of ['x', 'z']) {
        const skyline: number[] = [];
        for (let along = -500; along <= 500; along += 20) {
          let maximum = -Infinity;
          for (let across = -550; across <= 550; across += 20)
            maximum = Math.max(maximum, world.groundHeight(peak.x + (axis === 'x' ? along : across), peak.z + (axis === 'z' ? along : across)));
          skyline.push(maximum);
        }
        const summit = Math.max(...skyline);
        let count = 0;
        for (let i = 2; i < skyline.length - 2; i++) {
          if (skyline[i] < summit * 0.6 || skyline[i] < skyline[i - 1] || skyline[i] <= skyline[i + 1]) continue;
          const left = Math.min(...skyline.slice(Math.max(0, i - 8), i));
          const right = Math.min(...skyline.slice(i + 1, i + 9));
          if (skyline[i] - Math.max(left, right) > 32) count++;
        }
        prominent.push(count);
      }
      assert.ok(Math.max(...prominent) >= 2, `the massif near ${peak.x}/${peak.z} has multiple substantial crests and a real separating col`);
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

test('bent crest shoulders and end caps have continuous support across either side', () => {
  const world = createWorldKernel(createRustRuntime(module), 'mountains');
  try {
    for (const massif of ALPINE_MASSIFS) for (const crest of massif.crests) for (let index = 1; index < crest.length; index++) {
      const a = crest[index - 1], b = crest[index], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      for (const t of [-0.08, 0, 0.2, 0.6, 1, 1.08]) for (const offset of [-15, -5, 0, 5, 15]) {
        const x = a[0] + dx * t - dz / length * offset, z = a[1] + dz * t + dx / length * offset;
        const left = world.groundHeight(x - dz / length * 0.001, z + dx / length * 0.001);
        const right = world.groundHeight(x + dz / length * 0.001, z - dx / length * 0.001);
        assert.ok(Math.abs(left - right) < 0.1, `crossing two millimetres near ${x}/${z} must not jump between unequal shoulder widths`);
        assert.ok(Math.abs(left - explorationGroundHeight('mountains', x - dz / length * 0.001, z + dx / length * 0.001)) < 1e-8);
      }
    }
  } finally { world.dispose(); }
});
