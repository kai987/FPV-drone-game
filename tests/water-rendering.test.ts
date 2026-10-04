import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRustRuntime } from '../src/game/rust-runtime.ts';
import type { RustRuntime } from '../src/game/rust-runtime.ts';
import { createWorldKernel } from '../src/game/world-kernel.ts';
import { createSceneSimulation, generateRipplePixels } from '../src/game/scene-simulation.ts';
import type { SceneSimulation } from '../src/game/scene-simulation.ts';
import { createWater } from '../src/game/water.ts';
import { TERRAIN_SIZE, WATER_LEVEL, WORLD_CENTER_Z } from '../src/game/landscape.ts';
import { CHECKPOINTS } from '../src/game/courses.ts';
import { TARGETS } from '../src/game/weapons.ts';
import { flightModule, urbanWorldFixture } from './helpers/urban-world-fixture.ts';

function near(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

function harborWater(scene: THREE.Scene): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const mesh = scene.getObjectByName('Harbor water');
  assert.ok(mesh instanceof THREE.Mesh && mesh.material instanceof THREE.ShaderMaterial,
    'the production harbor has its own shared optical-water material');
  return mesh as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

test('native ripple pixels need no scene generation and remain owned after Rust buffers are released or memory grows', () => {
  const native = createRustRuntime(flightModule), calls: string[] = [];
  const runtime: RustRuntime = {
    memory: native.memory,
    call(name, ...args) { calls.push(name); return native.call(name, ...args); },
    view: native.view,
  };
  const pixels = generateRipplePixels(runtime), saved = pixels.slice();
  assert.deepEqual(calls, ['scene_ripple_new', 'scene_ripple_ptr', 'scene_ripple_free']);
  assert.equal(pixels.length, 256 * 256 * 4);
  assert.notEqual(pixels.buffer, native.memory.buffer, 'GPU pixels cannot borrow a freed WASM allocation');
  native.memory.grow(1);
  assert.deepEqual(pixels, saved, 'growing other maps does not detach the texture pixels');
  assert.deepEqual(generateRipplePixels(runtime), saved, 'reused native allocations preserve the deterministic wave pattern');
  assert.throws(() => generateRipplePixels(runtime, 0), /Ripple size/);
  assert.equal(calls.filter(name => name === 'scene_ripple_free').length, 2,
    'each successful allocation is freed; a rejected allocation is never freed as a handle');
  assert.equal(calls.includes('scene_generate'), false);
  assert.equal(calls.includes('scene_new'), false);
});

test('harbor water samples native geography without river currents or negative-depth interpolation holes', () => {
  const fixture = urbanWorldFixture('harbor');
  try {
    const mesh = harborWater(fixture.scenery.scene), geometry = mesh.geometry;
    const positions = geometry.getAttribute('position'), depths = geometry.getAttribute('waterDepth');
    const currents = geometry.getAttribute('waterCurrent');
    assert.equal(depths.count, positions.count); assert.equal(currents.count, positions.count);
    assert.equal(depths.itemSize, 1); assert.equal(currents.itemSize, 3);
    near(mesh.position.y, WATER_LEVEL + 0.025);
    near(mesh.position.z, WORLD_CENTER_Z);
    let shallow = 0, deep = 0, coveredDryLand = 0;
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index) + mesh.position.x, z = positions.getZ(index) + mesh.position.z;
      const nativeDepth = WATER_LEVEL - fixture.kernel.groundHeight(x, z);
      const actual = depths.getX(index);
      near(actual, Math.fround(Math.max(0.055, nativeDepth)));
      assert.ok(actual > 0, 'positive vertex depths cannot interpolate to discarded holes beside narrow piers');
      if (nativeDepth <= 0) coveredDryLand++;
      if (actual < 3) shallow++;
      if (actual > 10) deep++;
      assert.equal(currents.getX(index), 0); assert.equal(currents.getY(index), 0); assert.equal(currents.getZ(index), 0);
    }
    assert.ok(shallow > 0 && deep > 0 && coveredDryLand > 0, 'native shallow water, open sea and covered pier/shore samples are all exercised');
    assert.equal(mesh.material.transparent, false); assert.equal(mesh.material.depthWrite, true);
    assert.equal(mesh.material.uniforms.opacityFloor.value, 1, 'deep ocean remains opaque without exposing the empty seabed');
    assert.equal(fixture.calls.includes('scene_generate'), false, 'the harbor requests only independent native ripple pixels');
    assert.equal(fixture.calls.filter(name => name === 'scene_ripple_new').length, 1);
    assert.equal(fixture.calls.filter(name => name === 'scene_ripple_free').length, 1);
  } finally { fixture.dispose(); }
});

test('harbor water follows world time and day/night state while releasing geometry, material and ripple texture once', () => {
  const fixture = urbanWorldFixture('harbor');
  try {
    const mesh = harborWater(fixture.scenery.scene), material = mesh.material;
    const ripple = material.uniforms.rippleMap.value;
    assert.ok(ripple instanceof THREE.DataTexture);
    assert.equal(ripple.wrapS, THREE.RepeatWrapping); assert.equal(ripple.wrapT, THREE.RepeatWrapping);
    assert.equal(ripple.minFilter, THREE.LinearMipmapLinearFilter); assert.equal(ripple.magFilter, THREE.LinearFilter);
    assert.equal(ripple.generateMipmaps, true); assert.equal(ripple.colorSpace, THREE.NoColorSpace);
    fixture.scenery.update(3.75, 0); assert.equal(material.uniforms.time.value, 3.75);
    fixture.scenery.setNight(true);
    assert.equal(material.uniforms.night.value, 1);
    assert.equal(material.uniforms.deepColor.value.getHexString(), '071c30');
    assert.equal(material.uniforms.skyColor.value.getHexString(), '101f2d');
    fixture.scenery.setNight(false);
    assert.equal(material.uniforms.night.value, 0);
    assert.equal(material.uniforms.deepColor.value.getHexString(), '123e49');
    assert.equal(material.uniforms.skyColor.value.getHexString(), 'a6cbd6');
    assert.deepEqual(material.uniforms.fogDensity.value.toArray(), [0.00028, 0.00042]);
    const disposed = { geometry: 0, material: 0, texture: 0 };
    mesh.geometry.addEventListener('dispose', () => { disposed.geometry++; });
    material.addEventListener('dispose', () => { disposed.material++; });
    ripple.addEventListener('dispose', () => { disposed.texture++; });
    fixture.dispose(); fixture.dispose();
    assert.deepEqual(disposed, { geometry: 1, material: 1, texture: 1 });
  } finally { fixture.dispose(); }
});

test('valley and harbor use identical native wave pixels while valley retains transparent shallows and external panorama ownership', () => {
  const harbor = urbanWorldFixture('harbor'), runtime = createRustRuntime(flightModule);
  const kernel = createWorldKernel(runtime);
  const course = new THREE.CatmullRomCurve3(CHECKPOINTS.map(checkpoint =>
    new THREE.Vector3(checkpoint.position.x, 0, checkpoint.position.z)), true, 'centripetal').getPoints(280);
  const panorama = new THREE.Texture(), parent = new THREE.Scene();
  let simulation: SceneSimulation | undefined;
  let water: ReturnType<typeof createWater> | undefined;
  const samplingGeometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 300, 300);
  samplingGeometry.rotateX(-Math.PI / 2);
  try {
    simulation = createSceneSimulation(runtime, kernel, course, TARGETS, (course.length + 40) * 2);
    const positions = samplingGeometry.getAttribute('position'), points = new Float32Array(positions.count * 2);
    for (let index = 0; index < positions.count; index++) {
      points[index * 2] = positions.getX(index);
      points[index * 2 + 1] = positions.getZ(index) + WORLD_CENTER_Z;
    }
    const { heights } = kernel.sampleTerrain(points);
    water = createWater(panorama, simulation, points, heights, Math.PI / 2, new THREE.Vector2(0.4, 0.6));
    parent.add(water.group);
    const surface = water.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const material = surface.material, ripple = material.uniforms.rippleMap.value as THREE.DataTexture;
    const oceanRipple = harborWater(harbor.scenery.scene).material.uniforms.rippleMap.value as THREE.DataTexture;
    assert.deepEqual(ripple.image.data, oceanRipple.image.data, 'both visible water meshes use the same complete Rust ripple texture');
    assert.equal(material.transparent, true); assert.equal(material.depthWrite, false);
    assert.equal(material.uniforms.opacityFloor.value, 0, 'shallow river and lake water retain fish visibility');
    assert.equal(material.uniforms.panorama.value, panorama);
    assert.equal(surface.geometry.getAttribute('waterDepth').count, surface.geometry.getAttribute('position').count);
    near(surface.position.y, WATER_LEVEL + 0.025);
    water.update(8.25); assert.equal(material.uniforms.time.value, 8.25);
    water.setNight(true); assert.equal(material.uniforms.night.value, 1);
    assert.equal(material.uniforms.skyColor.value.getHexString(), '101e32');
    water.setNight(false); assert.equal(material.uniforms.skyColor.value.getHexString(), 'b0c9d5');
    const disposed = { geometry: 0, material: 0, ripple: 0, panorama: 0 };
    surface.geometry.addEventListener('dispose', () => { disposed.geometry++; });
    material.addEventListener('dispose', () => { disposed.material++; });
    ripple.addEventListener('dispose', () => { disposed.ripple++; });
    panorama.addEventListener('dispose', () => { disposed.panorama++; });
    water.dispose(); water = undefined;
    assert.equal(parent.children.length, 0);
    assert.deepEqual(disposed, { geometry: 1, material: 1, ripple: 1, panorama: 0 });
  } finally {
    water?.dispose(); samplingGeometry.dispose(); panorama.dispose();
    simulation?.dispose(); kernel.dispose(); harbor.dispose();
  }
});
