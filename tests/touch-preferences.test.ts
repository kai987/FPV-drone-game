import assert from 'node:assert/strict';
import test from 'node:test';
import { TouchGestureController } from '../src/components/touch-gesture.ts';
import { DEFAULT_TOUCH_SETTINGS, normalizeTouchSettings } from '../src/components/touch-settings.ts';

function advance(controller: TouchGestureController, start: number, duration: number) {
  let snapshot = controller.sample(start);
  for (let now = start + 16; now < start + duration; now += 16) snapshot = controller.sample(now);
  snapshot = controller.sample(start + duration);
  for (const axis of Object.values(snapshot.axes)) assert.ok(Number.isFinite(axis) && Math.abs(axis) <= 1);
  return snapshot;
}

test('touch settings reject nonfinite data and bound customization to usable ranges', () => {
  assert.deepEqual(normalizeTouchSettings({ sensitivity: NaN, accelerationMs: Infinity, invertVertical: 'true' }), DEFAULT_TOUCH_SETTINGS);
  assert.deepEqual(normalizeTouchSettings({ sensitivity: 0, accelerationMs: 99_000, invertVertical: true }),
    { sensitivity: 0.5, accelerationMs: 4_000, invertVertical: true });
  for (const invalid of [null, [], false, 'settings']) assert.deepEqual(normalizeTouchSettings(invalid), DEFAULT_TOUCH_SETTINGS);
});

test('the configured hold duration changes acceleration without changing the maximum thrust', () => {
  const fast = new TouchGestureController({ accelerationMs: 500 });
  const slow = new TouchGestureController({ accelerationMs: 4_000 });
  for (const controller of [fast, slow]) controller.begin(1, 100, 200, 0);
  assert.equal(advance(fast, 0, 1_000).axes.forward, 1);
  const slowAtOneSecond = advance(slow, 0, 1_000);
  assert.ok(slowAtOneSecond.axes.forward > 0.16 && slowAtOneSecond.axes.forward < 0.4);
  assert.equal(advance(slow, 1_000, 3_000).axes.forward, 1);
});

test('sensitivity changes travel needed for steering while retaining the same bounded directions', () => {
  const low = new TouchGestureController({ sensitivity: 0.5 });
  const high = new TouchGestureController({ sensitivity: 2 });
  for (const controller of [low, high]) { controller.begin(1, 100, 200, 0); controller.move(1, 140, 200); }
  const gentle = advance(low, 0, 2_000).axes, strong = advance(high, 0, 2_000).axes;
  assert.ok(gentle.strafe > 0 && gentle.strafe < 0.3);
  assert.equal(strong.strafe, 1); assert.equal(strong.forward, 0);
});

test('vertical reversal changes both forward/back and climb gestures without reversing yaw or strafe', () => {
  const normal = new TouchGestureController();
  const reversed = new TouchGestureController({ invertVertical: true });
  for (const controller of [normal, reversed]) {
    controller.begin(1, 100, 200, 0); controller.begin(2, 300, 200, 0);
    controller.move(1, 100, 124); controller.move(2, 376, 124);
  }
  const a = advance(normal, 0, 2_000).axes, b = advance(reversed, 0, 2_000).axes;
  assert.equal(a.forward, 1); assert.equal(b.forward, -1);
  assert.equal(a.climb, 1); assert.equal(b.climb, -1);
  assert.equal(a.yaw, b.yaw); assert.equal(a.strafe, b.strafe);
});

test('changing settings cancels existing pointer roles and cannot leave stale thrust active', () => {
  const controller = new TouchGestureController(); controller.begin(1, 100, 200, 0);
  assert.equal(advance(controller, 0, 2_000).axes.forward, 1);
  controller.configure({ sensitivity: 1.5, accelerationMs: 750, invertVertical: true });
  assert.equal(controller.active, false); assert.deepEqual(controller.pointerIds, []);
  assert.deepEqual(controller.sample(2_016).axes, { forward: 0, strafe: 0, climb: 0, yaw: 0 });
});
