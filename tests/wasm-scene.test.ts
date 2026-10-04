import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createSceneSimulation } from '../src/game/scene-simulation.ts';
import { groundHeight, waterDistance, LAKES, RIVER_SAMPLES, WATER_LEVEL, WORLD_BOUNDS } from '../src/game/landscape.ts';
import { clearance } from '../src/game/rural-layout.ts';
import { TARGETS } from '../src/game/weapons.ts';
import { CHECKPOINTS } from '../src/game/world.ts';
import { DRONES, getFlightConfig } from '../src/game/drone-catalog.ts';
import { createWorldFlightSimulation } from '../src/game/flight-simulation.ts';
import { createFlightState, crossesCheckpoint } from '../src/game/flight.ts';
import type { WorldObstacle } from '../src/game/world.ts';
import { courseControls } from './helpers/course-controller.ts';
import { referenceScene } from './helpers/scene-reference.ts';

const module = await WebAssembly.compile(await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url)));
const course = new THREE.CatmullRomCurve3(CHECKPOINTS.map(p => new THREE.Vector3(p.position.x, 0, p.position.z)), true, 'centripetal').getPoints(280);
const skip = (course.length + 40) * 2;
const reference = referenceScene(course, skip);
function setup() {
  const runtime = createRustRuntime(module); const world = createWorldKernel(runtime);
  const scene = createSceneSimulation(runtime, world, course, TARGETS, skip);
  return { runtime, world, scene, dispose() { scene.dispose(); world.dispose(); } };
}
function near(actual: number, expected: number, context: string, tolerance = 2e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance + Math.abs(expected) * 2e-12, `${context}: ${actual} vs ${expected}`);
}

test('real Rust scene generation preserves the full seeded forest, rocks, banks and shrubs', () => {
  const s = setup();
  try {
    const p = s.scene.placements;
    assert.equal(p.trees.length, reference.trees.length); assert.equal(p.rocks.length, reference.rocks.count);
    assert.equal(p.banks.length, reference.banks.count); assert.equal(p.shrubs.length, reference.shrubs.length);
    for (let i = 0; i < p.trees.length; i++) for (const key of ['x', 'z', 'y', 'height', 'width', 'angle', 'shade'] as const) near(p.trees[i][key], reference.trees[i][key], `tree ${i}/${key}`);
    const transform = new THREE.Object3D(); const color = new THREE.Color();
    for (const kind of ['rocks', 'banks'] as const) p[kind].forEach((stone, index) => {
      transform.position.set(stone.x, stone.y, stone.z); transform.rotation.set(stone.rotation[0], stone.rotation[1], stone.rotation[2]);
      transform.scale.set(stone.scale[0], stone.scale[1], stone.scale[2]); transform.updateMatrix();
      transform.matrix.elements.forEach((v, axis) => near(v, reference[kind].matrices[index][axis], `${kind}/${index}/matrix/${axis}`));
      if (kind === 'rocks') color.set('#f4f2e7').multiplyScalar(stone.tint);
      else color.set('#b7bdac').lerp(new THREE.Color('#f5efdf'), stone.tint);
      color.toArray().forEach((v, axis) => near(v, reference[kind].colors[index][axis], `${kind}/${index}/color/${axis}`));
    });
    p.shrubs.forEach((shrub, index) => {
      for (const key of ['x', 'y', 'z', 'height', 'seed'] as const) near(shrub[key], reference.shrubs[index][key], `shrub/${index}/${key}`);
      assert.ok(clearance(shrub.x, shrub.z, 4)); assert.ok(waterDistance(shrub.x, shrub.z) >= 3);
    });
  } finally { s.dispose(); }
});

test('Rust batch terrain colours preserve full 301 by 301 geometry and shoreline tints', () => {
  const s = setup();
  try {
    const n = 300; const row = n + 1; const points = new Float32Array(row * row * 2);
    for (let z = 0; z < row; z++) for (let x = 0; x < row; x++) points.set([-2100 + x * 14, 1400 - z * 14], (z * row + x) * 2);
    const { heights, waterDistances } = s.world.sampleTerrain(points);
    const colors = s.scene.terrainColors(points, heights, waterDistances, n, 14);
    const color = new THREE.Color(); const rock = new THREE.Color('#c3c2b5'); const beach = new THREE.Color('#d0c0a0'); const bed = new THREE.Color('#84917d');
    for (let i = 0; i < heights.length; i++) {
      const x = points[i * 2], z = points[i * 2 + 1], h = heights[i], column = i % row, r = Math.floor(i / row);
      assert.equal(h, Math.fround(groundHeight(x, z))); assert.equal(waterDistances[i], Math.fround(waterDistance(x, z)));
      const dx = (heights[i + (column < n ? 1 : 0)] - heights[i - (column > 0 ? 1 : 0)]) / 14 / 2;
      const dz = (heights[i + (r < n ? row : 0)] - heights[i - (r > 0 ? row : 0)]) / 14 / 2;
      const shade = 0.81 + Math.sin(x * 0.0064 + 0.8) * Math.cos(z * 0.0051) * 0.095 + Math.sin((x - z) * 0.014) * 0.024;
      color.set('#bdc4a1').multiplyScalar(shade).lerp(rock, Math.min(0.78, Math.max(0, Math.hypot(dx, dz) - 0.27) * 1.7 + Math.max(0, h - 220) / 720));
      if (waterDistances[i] < 20 && h < WATER_LEVEL + 8) color.lerp(waterDistances[i] < -2 ? bed : beach, Math.min(1, Math.max(0, (20 - waterDistances[i]) / 20)) * 0.84);
      color.toArray().forEach((v, axis) => near(colors[i * 3 + axis], Math.fround(v), `vertex/${i}/tint/${axis}`, 1e-7));
    }
  } finally { s.dispose(); }
});

function referenceCurrent(x: number, z: number) {
  let distanceSquared = Infinity, directionX = 0, directionZ = 1;
  for (let i = 0; i < RIVER_SAMPLES.length - 1; i++) {
    const a = RIVER_SAMPLES[i], b = RIVER_SAMPLES[i + 1], dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / length));
    const distance = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
    if (distance < distanceSquared) { distanceSquared = distance; directionX = dx / Math.sqrt(length); directionZ = dz / Math.sqrt(length); }
  }
  let strength = 1 - THREE.MathUtils.smoothstep(Math.sqrt(distanceSquared), 22, 80);
  for (const lake of LAKES) {
    const dx = x - lake.x, dz = z - lake.z;
    strength *= THREE.MathUtils.smoothstep(Math.hypot((dx * Math.cos(lake.rotation) + dz * Math.sin(lake.rotation)) / lake.radiusX,
      (-dx * Math.sin(lake.rotation) + dz * Math.cos(lake.rotation)) / lake.radiusZ), 0.72, 1.12);
  }
  return [directionX * strength, directionZ * strength, strength];
}

test('Rust water batches preserve depth, river flow and lake attenuation across multiple chunks', () => {
  const s = setup();
  try {
    const points = new Float32Array(2200 * 2);
    for (let i = 0; i < 2200; i++) {
      const p = RIVER_SAMPLES[i % RIVER_SAMPLES.length]; points.set([p.x + (i % 7 - 3) * 17, p.z + (i % 11 - 5) * 13], i * 2);
    }
    const { heights } = s.world.sampleTerrain(points); const data = s.scene.waterData(points, heights);
    for (let i = 0; i < heights.length; i++) {
      const x = points[i * 2], z = points[i * 2 + 1], depth = WATER_LEVEL - groundHeight(x, z);
      near(data.depths[i], Math.fround(depth), `water/${i}/depth`, 1e-6);
      const expected = depth > -6 ? referenceCurrent(x, z) : [0, 0, 0];
      expected.forEach((v, axis) => near(data.currents[i * 3 + axis], Math.fround(v), `water/${i}/current/${axis}`, 1e-7));
    }
  } finally { s.dispose(); }
});

function referenceRipple(size: number) {
  let seed = 821; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const waves = Array.from({ length: 48 }, (_, i) => {
    const x = Math.round(8 + random() * 48), z = Math.round((random() - 0.5) * 20), length = Math.hypot(x, z) || 1;
    return { x, z, phase: random() * Math.PI * 2, weight: (0.55 + random() * 0.45) / Math.sqrt(i + 6), length };
  });
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sx = 0, sz = 0, height = 0;
    for (const wave of waves) {
      const phase = (x * wave.x + y * wave.z) / size * Math.PI * 2 + wave.phase, slope = Math.cos(phase) * wave.weight;
      sx += slope * wave.x / wave.length; sz += slope * wave.z / wave.length; height += Math.sin(phase) * wave.weight;
    }
    [sx, sz, height].forEach((v, c) => { pixels[(y * size + x) * 4 + c] = Math.round(127.5 + Math.min(1, Math.max(-1, v * 0.3)) * 127.5); });
    pixels[(y * size + x) * 4 + 3] = 255;
  }
  return pixels;
}

test('Rust produces the complete deterministic ripple texture and releases generation buffers', () => {
  const s = setup();
  try {
    const actual = s.scene.ripplePixels(256), expected = referenceRipple(256);
    assert.equal(actual.length, expected.length);
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= 1, `ripple byte ${i}`));
    assert.throws(() => s.scene.ripplePixels(0), /Ripple size/);
    s.runtime.memory.grow(1);
    assert.deepEqual(s.scene.ripplePixels(16), referenceRipple(16));
    s.scene.dispose(); s.scene.dispose(); assert.throws(() => s.scene.ripplePixels(), /disposed/);
  } finally { s.dispose(); }
});

test('native Rust world and generated obstacle grid support all twelve full-course flights', () => {
  const s = setup();
  try {
    const obstacles: WorldObstacle[] = [...s.scene.placements.trees.map(t => ({ x: t.x, z: t.z, radius: 0.35 + t.height * 0.016, height: t.height })),
      ...[...s.scene.placements.rocks, ...s.scene.placements.banks].map(t => ({ x: t.x, z: t.z, radius: t.radius, height: t.height }))];
    s.world.setObstacles(obstacles);
    for (const spec of DRONES) for (const mode of ['assisted', 'sport'] as const) {
      const simulation = createWorldFlightSimulation(s.runtime, s.world.handle); const state = createFlightState();
      let clock = 0, passed = 0, contacts = 0;
      try {
        for (let frame = 0; frame < 7200 && passed < CHECKPOINTS.length; frame++) {
          const gate = CHECKPOINTS[passed], previous = { ...state.position };
          const input = passed < 2 ? { forward: 1, strafe: 0, climb: 0, yaw: 0 } : courseControls(state, gate, getFlightConfig(spec.id, mode).speed);
          const result = simulation.step(state, input, 1 / 60, mode, spec.flight, { strength: 'calm', direction: 0 }, clock, WORLD_BOUNDS);
          clock = result.windClock; if (state.collision || result.boundaryContact || result.obstacleContact) contacts++;
          if (crossesCheckpoint(previous, state.position, gate)) passed++;
        }
        assert.equal(passed, 8, `${spec.id}/${mode} full native-world course`); assert.equal(contacts, 0);
      } finally { simulation.dispose(); }
    }
  } finally { s.dispose(); }
});
