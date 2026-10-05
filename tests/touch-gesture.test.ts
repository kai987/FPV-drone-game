import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TouchGestureController, TOUCH_GESTURE_RAMP_MS, TOUCH_GESTURE_RADIUS, TOUCH_GESTURE_DEAD_ZONE } from '../src/components/touch-gesture.ts';
import type { TouchFlightAxes, TouchGestureSnapshot } from '../src/components/touch-gesture.ts';
import { createFlightState } from '../src/game/flight.ts';
import { getDroneSpec, getFlightConfig } from '../src/game/drone-catalog.ts';
import { createFlightSimulation } from '../src/game/flight-simulation.ts';

const zero: TouchFlightAxes = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
const tolerance = 1e-10;

function near(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

function bounded(axes: TouchFlightAxes) {
  for (const [axis, value] of Object.entries(axes)) {
    assert.ok(Number.isFinite(value), `${axis} must be finite`);
    assert.ok(Math.abs(value) <= 1 + tolerance, `${axis} must stay within [-1, 1]: ${value}`);
  }
  assert.ok(Math.hypot(axes.forward, axes.strafe) <= 1 + tolerance,
    `horizontal diagonal must be normalized: ${JSON.stringify(axes)}`);
}

/** Advance like RAF; a suspended browser's single large time jump is not a hold ramp. */
function clock(controller: TouchGestureController, start = 0) {
  let now = start;
  controller.sample(now);
  return {
    get now() { return now; },
    advance(duration: number, inspect?: (snapshot: TouchGestureSnapshot) => void) {
      const end = now + duration;
      let snapshot = controller.snapshot(now);
      while (now < end) {
        now = Math.min(end, now + 16);
        snapshot = controller.sample(now);
        bounded(snapshot.axes);
        inspect?.(snapshot);
      }
      return snapshot;
    },
  };
}

test('a stationary hold starts gently, increases monotonically and reaches full thrust at two seconds', () => {
  const gesture = new TouchGestureController();
  assert.equal(gesture.begin(1, 160, 260, 0), true);
  const time = clock(gesture);
  const initial = gesture.snapshot(0);
  near(initial.throttle, 0.16, 'initial throttle');
  const firstFrame = time.advance(16);
  assert.ok(firstFrame.axes.forward > 0 && firstFrame.axes.forward <= 0.2);
  let previousThrottle = initial.throttle;
  let previousForward = firstFrame.axes.forward;
  for (const elapsed of [250, 500, 1_000, 1_500, TOUCH_GESTURE_RAMP_MS]) {
    const snapshot = time.advance(elapsed - time.now, frame => {
      assert.ok(frame.throttle >= previousThrottle - tolerance, 'hold throttle should not fall');
      assert.ok(frame.axes.forward >= previousForward - tolerance, 'held forward thrust should not fall');
      previousThrottle = frame.throttle;
      previousForward = frame.axes.forward;
    });
    assert.equal(snapshot.axes.strafe, 0);
    assert.equal(snapshot.axes.climb, 0);
    assert.equal(snapshot.axes.yaw, 0);
  }
  const full = gesture.snapshot(time.now);
  near(full.throttle, 1, 'two-second throttle');
  near(full.axes.forward, 1, 'two-second forward thrust');
  near(time.advance(1_000).axes.forward, 1, 'continued hold does not overshoot');
});

test('small finger jitter stays in the dead zone and preserves the gentle forward hold', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 160, 260, 0);
  const time = clock(gesture);
  gesture.move(1, 160 + TOUCH_GESTURE_DEAD_ZONE - 1, 260 - TOUCH_GESTURE_DEAD_ZONE + 1);
  const inside = time.advance(600);
  assert.equal(inside.axes.strafe, 0);
  assert.ok(inside.axes.forward > 0 && inside.axes.forward < 1);
  gesture.move(1, 160 + TOUCH_GESTURE_DEAD_ZONE + 1, 260);
  assert.ok(time.advance(300).axes.strafe > 0, 'drag beyond the dead zone should register');
});

test('crossing either side of the vertical dead zone does not jump from cruising to braking or reverse', () => {
  for (const dx of [0, 32, -32]) {
    const gesture = new TouchGestureController();
    gesture.begin(1, 100, 100, 0);
    const time = clock(gesture);
    time.advance(TOUCH_GESTURE_RAMP_MS);
    for (const sign of [-1, 1]) {
      gesture.move(1, 100 + dx, 100 + sign * (TOUCH_GESTURE_DEAD_ZONE - 0.01));
      const inside = time.advance(1_000).axes;
      gesture.move(1, 100 + dx, 100 + sign * (TOUCH_GESTURE_DEAD_ZONE + 0.01));
      const outside = time.advance(1_000).axes;
      assert.ok(Math.abs(outside.forward - inside.forward) < 0.001,
        `crossing the vertical dead zone must stay continuous at x=${dx}, sign=${sign}`);
      assert.ok(outside.forward > 0.6, 'a tiny drag must preserve forward cruising');
      assert.ok(Math.abs(outside.strafe - inside.strafe) < 0.001, 'a vertical boundary must not jump sideways thrust');
    }
  }
});

test('forward drags preserve full forward hold and do not slow a mixed forward and sideways gesture', () => {
  for (const dx of [0, 32, -32]) {
    const gesture = new TouchGestureController();
    gesture.begin(1, 100, 100, 0);
    const time = clock(gesture);
    time.advance(TOUCH_GESTURE_RAMP_MS);
    gesture.move(1, 100 + dx, 100);
    let previous = time.advance(1_000).axes.forward;
    for (const upwardDistance of [TOUCH_GESTURE_DEAD_ZONE + 0.25, 28, 52, TOUCH_GESTURE_RADIUS]) {
      gesture.move(1, 100 + dx, 100 - upwardDistance);
      const axes = time.advance(1_000).axes;
      assert.ok(axes.forward >= previous - tolerance, 'dragging farther forward must not reduce forward thrust');
      if (dx === 0) near(axes.forward, 1, 'upward drag preserves full forward hold');
      else assert.ok(Math.sign(axes.strafe) === Math.sign(dx), 'a mixed drag keeps its sideways direction');
      previous = axes.forward;
    }
  }
});

test('a downward drag progressively slows cruising, crosses neutral and then reverses', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 100, 0);
  const time = clock(gesture);
  time.advance(TOUCH_GESTURE_RAMP_MS);
  let previous = 1;
  for (let distance = TOUCH_GESTURE_DEAD_ZONE; distance <= TOUCH_GESTURE_RADIUS; distance += 8) {
    gesture.move(1, 100, 100 + distance);
    const axes = time.advance(1_000).axes;
    assert.ok(axes.forward <= previous + tolerance, 'downward travel must monotonically reduce forward thrust');
    assert.ok(previous - axes.forward <= 0.3, 'small downward travel must not jump to reverse');
    if (distance === 20) assert.ok(axes.forward > 0.6, 'a gentle downward drag slows while still flying forward');
    if (distance === 44) near(axes.forward, 0, 'halfway travel beyond the dead zone reaches neutral');
    if (distance === 60) assert.ok(axes.forward < 0, 'a deeper downward drag engages reverse');
    assert.equal(axes.strafe, 0);
    previous = axes.forward;
  }
  near(previous, -1, 'full downward travel reaches full reverse');
});

test('mixed braking preserves sideways direction and remains continuous across the horizontal dead zone', () => {
  for (const sign of [-1, 1]) {
    const gesture = new TouchGestureController();
    gesture.begin(1, 100, 100, 0);
    const time = clock(gesture);
    time.advance(TOUCH_GESTURE_RAMP_MS);
    gesture.move(1, 100 + sign * 32, 100);
    const cruising = time.advance(1_000).axes;
    gesture.move(1, 100 + sign * 32, 120);
    const braking = time.advance(1_000).axes;
    assert.ok(braking.forward > 0 && braking.forward < cruising.forward, 'a gentle mixed downward drag slows without immediately reversing');
    near(braking.strafe, cruising.strafe, 'gentle braking preserves sideways thrust');
    for (const dy of [-20, 20]) {
      gesture.move(1, 100 + sign * (TOUCH_GESTURE_DEAD_ZONE - 0.01), 100 + dy);
      const inside = time.advance(1_000).axes;
      gesture.move(1, 100 + sign * (TOUCH_GESTURE_DEAD_ZONE + 0.01), 100 + dy);
      const outside = time.advance(1_000).axes;
      assert.ok(Math.abs(outside.forward - inside.forward) < 0.001, 'crossing the horizontal dead zone must not jump forward thrust');
      assert.ok(Math.abs(outside.strafe - inside.strafe) < 0.001, 'crossing the horizontal dead zone must not jump sideways thrust');
    }
  }
});

test('rapid changes between mixed drags keep the published axes smooth frame by frame', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 100, 0);
  const time = clock(gesture);
  let previous = time.advance(TOUCH_GESTURE_RAMP_MS).axes;
  for (const [dx, dy] of [[13, -13], [76, 0], [32, 20], [0, 76], [-76, -76], [0, 0]]) {
    gesture.move(1, 100 + dx, 100 + dy);
    time.advance(1_000, snapshot => {
      for (const axis of ['forward', 'strafe'] as const) {
        assert.ok(Math.abs(snapshot.axes[axis] - previous[axis]) <= 0.05,
          `${axis} must not jump by more than 5% in one 16ms frame`);
      }
      previous = snapshot.axes;
    });
  }
});

test('primary drag follows screen signs, supports reverse and becomes pure strafe at full side travel', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 160, 260, 0);
  const time = clock(gesture);
  time.advance(TOUCH_GESTURE_RAMP_MS);
  for (const [dx, dy, forward, strafe] of [
    [0, -TOUCH_GESTURE_RADIUS, 1, 0],
    [TOUCH_GESTURE_RADIUS, 0, 0, 1],
    [0, TOUCH_GESTURE_RADIUS, -1, 0],
    [-TOUCH_GESTURE_RADIUS, 0, 0, -1],
  ]) {
    assert.equal(gesture.move(1, 160 + dx, 260 + dy), true);
    const axes = time.advance(1_000).axes;
    near(axes.forward, forward, 'signed forward');
    near(axes.strafe, strafe, 'signed strafe');
  }
});

test('reversing a drag brakes through zero before requesting thrust in the opposite direction', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 100, 0);
  const time = clock(gesture);
  time.advance(TOUCH_GESTURE_RAMP_MS);
  gesture.move(1, 100, 100 + TOUCH_GESTURE_RADIUS);
  const values: number[] = [];
  time.advance(1_000, snapshot => values.push(snapshot.axes.forward));
  const firstNegative = values.findIndex(value => value < -tolerance);
  assert.ok(firstNegative > 0, 'reverse should eventually engage after braking');
  near(values[firstNegative - 1], 0, 'neutral frame before reverse');
  near(values.at(-1)!, -1, 'settled reverse');
});

test('diagonal motion remains normalized during turns as well as at its settled target', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 100, 0);
  const time = clock(gesture);
  time.advance(TOUCH_GESTURE_RAMP_MS);
  gesture.move(1, 100 + TOUCH_GESTURE_RADIUS, 100 - TOUCH_GESTURE_RADIUS);
  const diagonal = time.advance(1_000).axes;
  assert.ok(diagonal.forward > 0.6 && diagonal.strafe > 0.6);
  near(Math.hypot(diagonal.forward, diagonal.strafe), 1, 'settled diagonal');
  for (const [dx, dy] of [
    [TOUCH_GESTURE_RADIUS, 0], [-TOUCH_GESTURE_RADIUS, -TOUCH_GESTURE_RADIUS],
    [0, TOUCH_GESTURE_RADIUS], [TOUCH_GESTURE_RADIUS, TOUCH_GESTURE_RADIUS],
  ]) {
    gesture.move(1, 100 + dx, 100 + dy);
    time.advance(1_000);
  }
});

test('the second pointer independently controls climb and yaw, with up positive and right negative', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 220, 0);
  gesture.begin(2, 300, 220, 0);
  const time = clock(gesture);
  gesture.move(2, 300 + TOUCH_GESTURE_RADIUS, 220 - TOUCH_GESTURE_RADIUS);
  const upRight = time.advance(600);
  near(upRight.axes.climb, 1, 'upward drag climbs');
  near(upRight.axes.yaw, -1, 'rightward drag turns right');
  assert.ok(upRight.axes.forward > 0 && upRight.axes.forward < 1, 'primary still has its own hold ramp');
  gesture.move(2, 300 - TOUCH_GESTURE_RADIUS, 220 + TOUCH_GESTURE_RADIUS);
  const downLeft = time.advance(1_000);
  near(downLeft.axes.climb, -1, 'downward drag descends');
  near(downLeft.axes.yaw, 1, 'leftward drag turns left');
  assert.equal(downLeft.axes.strafe, 0);
});

test('third and duplicate pointers are ignored without disturbing either owned control role', () => {
  const gesture = new TouchGestureController();
  assert.equal(gesture.begin(1, 100, 220, 0), true);
  assert.equal(gesture.begin(2, 300, 220, 0), true);
  assert.equal(gesture.begin(1, 900, 900, 10), false);
  assert.equal(gesture.begin(3, 0, 0, 10), false);
  assert.equal(gesture.move(3, 999, -999), false);
  assert.equal(gesture.end(3), false);
  assert.deepEqual(gesture.pointerIds, [1, 2]);
  const fingers = gesture.snapshot(10).fingers;
  assert.deepEqual(fingers.map(finger => [finger.id, finger.role, finger.originX, finger.originY]),
    [[1, 'flight', 100, 220], [2, 'attitude', 300, 220]]);
});

test('releasing or cancelling one pointer immediately zeros only its owned axes', () => {
  for (const releasedId of [1, 2]) {
    const gesture = new TouchGestureController();
    gesture.begin(1, 100, 220, 0);
    gesture.begin(2, 300, 220, 0);
    gesture.move(1, 100 + TOUCH_GESTURE_RADIUS, 220 - TOUCH_GESTURE_RADIUS);
    gesture.move(2, 300 + TOUCH_GESTURE_RADIUS, 220 - TOUCH_GESTURE_RADIUS);
    const time = clock(gesture);
    const before = time.advance(TOUCH_GESTURE_RAMP_MS).axes;
    assert.equal(gesture.end(releasedId), true);
    const after = gesture.snapshot(time.now).axes;
    const owned = releasedId === 1 ? ['forward', 'strafe'] as const : ['climb', 'yaw'] as const;
    const remaining = releasedId === 1 ? ['climb', 'yaw'] as const : ['forward', 'strafe'] as const;
    for (const axis of owned) assert.equal(after[axis], 0, `${axis} must stop immediately`);
    for (const axis of remaining) assert.equal(after[axis], before[axis], `${axis} must preserve the other pointer`);
    assert.equal(gesture.active, true);
    assert.equal(gesture.end(releasedId), false, 'duplicate release or lost capture is harmless');
    time.advance(200);
    for (const axis of owned) assert.equal(gesture.snapshot(time.now).axes[axis], 0);
  }
});

test('a remaining attitude finger never becomes forward input, and a fresh press gets a fresh flight ramp', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 220, 0);
  gesture.begin(2, 300, 220, 0);
  gesture.begin(3, 20, 20, 0);
  gesture.move(2, 300 + TOUCH_GESTURE_RADIUS, 220 - TOUCH_GESTURE_RADIUS);
  const time = clock(gesture);
  time.advance(TOUCH_GESTURE_RAMP_MS);
  gesture.end(1);
  const lone = time.advance(2_000);
  assert.equal(lone.axes.forward, 0);
  assert.equal(lone.axes.strafe, 0);
  assert.deepEqual(lone.fingers.map(finger => [finger.id, finger.role]), [[2, 'attitude']]);
  assert.equal(gesture.move(3, 40, 40), false, 'ignored third finger stays ignored after a slot opens');
  assert.equal(gesture.begin(3, 40, 40, time.now), true, 'a new down event can claim the free flight role');
  near(gesture.snapshot(time.now).throttle, 0.16, 'new press starts gently');
  const fresh = time.advance(16);
  assert.ok(fresh.axes.forward > 0 && fresh.axes.forward <= 0.2);
  assert.equal(fresh.axes.climb, 1);
  assert.equal(fresh.axes.yaw, -1);
  near(time.advance(TOUCH_GESTURE_RAMP_MS - 16).axes.forward, 1, 'fresh press reaches full thrust');
});

test('reset cancels all pointers and stale events, while a later press starts from zero', () => {
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 220, 0);
  gesture.begin(2, 300, 220, 0);
  gesture.move(2, 300 + TOUCH_GESTURE_RADIUS, 220 - TOUCH_GESTURE_RADIUS);
  const time = clock(gesture);
  time.advance(1_000);
  gesture.reset();
  assert.equal(gesture.active, false);
  assert.deepEqual(gesture.pointerIds, []);
  assert.deepEqual(gesture.sample(time.now + 5_000).axes, zero);
  assert.equal(gesture.move(1, 50, 50), false);
  assert.equal(gesture.end(2), false);
  assert.equal(gesture.begin(4, 120, 220, time.now + 5_000), true);
  const restarted = clock(gesture, time.now + 5_000).advance(16);
  assert.ok(restarted.axes.forward > 0 && restarted.axes.forward < 0.2);
  assert.equal(restarted.axes.climb, 0);
  assert.equal(restarted.axes.yaw, 0);
});

test('snapshot inspection cannot advance the slew clock or mutate controller state', () => {
  const inspected = new TouchGestureController();
  const reference = new TouchGestureController();
  for (const gesture of [inspected, reference]) gesture.begin(1, 100, 220, 0);
  const time = clock(inspected);
  const referenceTime = clock(reference);
  time.advance(400); referenceTime.advance(400);
  const snapshot = inspected.snapshot(9_000);
  snapshot.axes.forward = Number.NaN;
  snapshot.fingers[0].x = Number.POSITIVE_INFINITY;
  assert.deepEqual(time.advance(16), referenceTime.advance(16));
});

test('invalid samples and extreme drags always produce finite bounded controls', () => {
  const gesture = new TouchGestureController();
  for (const values of [[Number.NaN, 100, 0], [100, Number.POSITIVE_INFINITY, 0], [100, 100, Number.NaN]]) {
    assert.equal(gesture.begin(1, values[0], values[1], values[2]), false);
  }
  gesture.begin(1, 100, 220, 0);
  gesture.begin(2, 300, 220, 0);
  const time = clock(gesture);
  time.advance(TOUCH_GESTURE_RAMP_MS);
  for (const [x, y] of [[Number.MAX_VALUE, -Number.MAX_VALUE], [-Number.MAX_VALUE, Number.MAX_VALUE], [0, 0]]) {
    gesture.move(1, x, y); gesture.move(2, y, x);
    time.advance(500);
  }
  assert.equal(gesture.move(1, Number.NaN, 0), false);
  assert.equal(gesture.move(2, 0, Number.NEGATIVE_INFINITY), false);
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -10, 0, Number.MAX_VALUE]) bounded(gesture.sample(now).axes);
  gesture.reset();
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) assert.deepEqual(gesture.sample(now).axes, zero);
});

test('real Rust flight responds to the hold ramp and applies ordinary braking after touch release', async () => {
  const bytes = await readFile(new URL('../src/game/generated/flight_core.wasm', import.meta.url));
  const module = await WebAssembly.compile(bytes);
  const simulation = createFlightSimulation(module, () => 0);
  const profile = getDroneSpec('freestyle').flight;
  const config = getFlightConfig('freestyle', 'assisted');
  const wind = { strength: 'calm' as const, direction: 0 };
  const gentle = createFlightState({ x: 0, y: 80, z: 55 });
  const fullStick = structuredClone(gentle);
  const gesture = new TouchGestureController();
  gesture.begin(1, 100, 220, 0);
  gesture.sample(0);
  const fps = 60;
  let windClock = 0;
  let previousSpeed = 0;
  try {
    for (let frame = 1; frame <= fps * 2; frame++) {
      const now = frame * 1_000 / fps;
      const axes = gesture.sample(now).axes;
      const result = simulation.step(gentle, axes, 1 / fps, 'assisted', profile, wind, windClock);
      windClock = result.windClock;
      const speed = Math.abs(gentle.velocity.z);
      assert.ok(speed >= previousSpeed - tolerance, 'hold should accelerate smoothly in calm air');
      assert.ok(speed <= config.speed + tolerance, 'hold must preserve the aircraft speed ceiling');
      if (frame === 1) {
        simulation.step(fullStick, { ...zero, forward: 1 }, 1 / fps, 'assisted', profile, wind, 0);
        assert.ok(speed > 0 && speed < Math.abs(fullStick.velocity.z) * 0.25, 'initial touch thrust should be gentler than a full stick');
      }
      previousSpeed = speed;
    }
    assert.ok(previousSpeed > config.speed * 0.8, 'two-second hold should approach cruising speed');
    assert.ok(gentle.position.z < 55, 'positive forward touch axes must move the real drone forward');
    gesture.end(1);
    assert.deepEqual(gesture.snapshot(2_000).axes, zero);
    const releaseSpeed = Math.abs(gentle.velocity.z);
    for (let frame = 1; frame <= fps; frame++) {
      const axes = gesture.sample(2_000 + frame * 1_000 / fps).axes;
      const result = simulation.step(gentle, axes, 1 / fps, 'assisted', profile, wind, windClock);
      windClock = result.windClock;
      const speed = Math.abs(gentle.velocity.z);
      assert.ok(speed <= previousSpeed + tolerance, 'release should brake without reapplying thrust');
      if (frame === 1) assert.ok(speed > 0, 'touch release must preserve physics braking rather than teleport to a stop');
      previousSpeed = speed;
    }
    near(previousSpeed, releaseSpeed * Math.exp(-config.brake), 'one-second Rust braking');
  } finally { simulation.dispose(); }
});
