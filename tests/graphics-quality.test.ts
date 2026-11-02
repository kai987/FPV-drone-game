import assert from 'node:assert/strict';
import test from 'node:test';
import { isQualityPreset, resolveGraphicsQuality } from '../src/game/graphics-quality.ts';
import { RenderPerformanceMonitor } from '../src/game/render-performance.ts';

const desktop = { isMobile: false, devicePixelRatio: 2, viewportWidth: 1440, maxTextureSize: 16384 };

test('auto mobile remains within the light panorama budget after rotation or on large tablets', () => {
  for (const viewportWidth of [390, 844, 1366, 3000]) {
    const mobile = resolveGraphicsQuality('auto', { ...desktop, isMobile: true, devicePixelRatio: 3, viewportWidth });
    assert.equal(mobile.panoramaResolution, 3548);
    assert.equal(mobile.maxPixelRatio, 1.25);
    assert.equal(mobile.shadowMapSize, 512);
    assert.equal(mobile.alpineDetail, 'medium');
    assert.equal(mobile.targetFps, 30);
  }
});

test('explicit high can opt into HD while respecting device texture and DPR limits', () => {
  assert.equal(resolveGraphicsQuality('high', { ...desktop, isMobile: true, viewportWidth: 390 }).panoramaResolution, 7096);
  assert.equal(resolveGraphicsQuality('high', { ...desktop, maxTextureSize: 4096 }).panoramaResolution, 3548);
  for (const preset of ['auto', 'low', 'medium', 'high'] as const) {
    assert.ok(resolveGraphicsQuality(preset, { ...desktop, devicePixelRatio: 0.8 }).maxPixelRatio <= 0.8);
  }
  assert.equal(resolveGraphicsQuality('auto', { ...desktop, viewportWidth: 300, devicePixelRatio: 1 }).panoramaResolution, 3548);
});

test('presets change the complete rendering budget together without changing geography', () => {
  const low = resolveGraphicsQuality('low', desktop), medium = resolveGraphicsQuality('medium', desktop), high = resolveGraphicsQuality('high', desktop);
  assert.deepEqual([low.panoramaResolution, medium.panoramaResolution, high.panoramaResolution], [3548, 3548, 7096]);
  assert.deepEqual([low.shadowMapSize, medium.shadowMapSize, high.shadowMapSize], [0, 1024, 2048]);
  assert.equal(resolveGraphicsQuality('auto', desktop).shadowMapSize, 1024, 'auto never upgrades the default shadow allocation');
  assert.deepEqual([low.alpineDetail, medium.alpineDetail, high.alpineDetail], ['low', 'medium', 'high']);
  assert.ok(low.detailDistance < medium.detailDistance && medium.detailDistance < high.detailDistance);
  assert.equal(low.antialias, false); assert.equal(high.antialias, true);
  assert.ok([low, medium, high].every(value => Object.isFrozen(value)));
});

test('storage-facing preset validation rejects unknown types and budgets tolerate invalid measurements', () => {
  for (const value of ['auto', 'low', 'medium', 'high']) assert.equal(isQualityPreset(value), true);
  for (const value of [null, undefined, 1, {}, 'ultra', 'HIGH']) assert.equal(isQualityPreset(value), false);
  const budget = resolveGraphicsQuality('auto', { ...desktop, devicePixelRatio: NaN, viewportWidth: NaN, maxTextureSize: NaN });
  assert.equal(budget.maxPixelRatio, 1); assert.equal(budget.panoramaResolution, 3548);
});

test('adaptive DPR never upgrades beyond the resolved preset even after sustained headroom', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 3, maxPixelRatio: 1.25 });
  const info = { render: { calls: 10, triangles: 1000 }, memory: { geometries: 3, textures: 2 } };
  for (let time = 0; time < 60000; time += 20) {
    monitor.recordFrame(time, 1, 1, 1, info);
    assert.ok(monitor.pixelRatio <= 1.25);
  }
  assert.equal(monitor.pixelRatio, 1.25);
  const low = new RenderPerformanceMonitor({ isMobile: false, devicePixelRatio: 3, maxPixelRatio: 1 });
  assert.equal(low.pixelRatio, 1);
});
