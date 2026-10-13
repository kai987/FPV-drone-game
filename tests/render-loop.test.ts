import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderLoop, renderModeFor } from '../src/game/render-loop.ts';
import type { GraphicsState, RenderDriver, RenderMode } from '../src/game/render-loop.ts';
import type { Status } from '../src/game/types.ts';

const AMBIENT_INTERVAL = 1000 / 12;
const statuses: Status[] = ['ready', 'flying', 'paused', 'finished'];
const graphicsStates: GraphicsState[] = ['ready', 'lost', 'restoring', 'failed'];
const visibleScene = { prepared: true, visible: true, obscured: false, graphics: 'ready' as const };

class FakeRenderDriver implements RenderDriver {
  now = 0;
  frames = new Map<number, (time: number) => void>();
  timers = new Map<number, { callback: () => void; due: number; delay: number }>();
  private nextHandle = 1;

  frame(callback: (time: number) => void) {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number) { this.frames.delete(handle); }

  timer(callback: () => void, delay: number) {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, due: this.now + delay, delay });
    return handle;
  }

  cancelTimer(handle: number) { this.timers.delete(handle); }

  frameAt(time: number) {
    assert.ok(time >= this.now, 'fake animation timestamps must be monotonic');
    this.now = time;
    // A RAF requested from a drawing callback belongs to the next browser frame.
    for (const handle of [...this.frames.keys()]) {
      const callback = this.frames.get(handle);
      this.frames.delete(handle);
      callback?.(time);
    }
  }

  advanceTo(time: number) {
    assert.ok(time >= this.now, 'fake timer clock must be monotonic');
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= time)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.now = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = time;
  }

  expectPending(frames: number, timers: number) {
    assert.equal(this.frames.size, frames, 'pending animation frames');
    assert.equal(this.timers.size, timers, 'pending idle timers');
  }
}

test('visible scenes render at a rate appropriate to game status', () => {
  const expected: Record<Status, RenderMode> = { ready: 'ambient', flying: 'active', paused: 'still', finished: 'still' };
  for (const status of statuses) {
    assert.equal(renderModeFor({ ...visibleScene, status }), expected[status], status);
    assert.equal(renderModeFor({ ...visibleScene, status, graphics: 'restoring' }), 'still',
      `restoring ${status} draws one recovery frame without starting gameplay`);
    for (const graphics of ['lost', 'failed'] as const) {
      assert.equal(renderModeFor({ ...visibleScene, status, graphics }), 'suspended', `${graphics} ${status}`);
    }
  }
});

test('unprepared, hidden or modal-obscured scenes stay suspended in every graphics and game state', () => {
  for (const prepared of [false, true]) {
    for (const visible of [false, true]) {
      for (const obscured of [false, true]) {
        if (prepared && visible && !obscured) continue;
        for (const graphics of graphicsStates) {
          for (const status of statuses) {
            const state = { prepared, visible, obscured, graphics, status };
            assert.equal(renderModeFor(state), 'suspended', JSON.stringify(state));
          }
        }
      }
    }
  }
});

test('active rendering owns exactly one RAF even with repeated mode updates and invalidations', () => {
  const driver = new FakeRenderDriver();
  const drawn: number[] = [];
  const loop = new RenderLoop(time => drawn.push(time), driver);
  loop.invalidate();
  driver.expectPending(0, 0);
  loop.setMode('active');
  for (let frame = 1; frame <= 4; frame++) {
    loop.setMode('active');
    loop.invalidate(); loop.invalidate();
    driver.expectPending(1, 0);
    driver.frameAt(frame * 16);
    assert.equal(drawn.length, frame);
    driver.expectPending(1, 0);
  }
  assert.deepEqual(drawn, [16, 32, 48, 64]);
  loop.dispose();
  driver.expectPending(0, 0);
});

test('ambient rendering waits for a 12 FPS timer before requesting each subsequent frame', () => {
  const driver = new FakeRenderDriver();
  const drawn: number[] = [];
  const loop = new RenderLoop(time => drawn.push(time), driver);
  loop.setMode('ambient');
  driver.expectPending(1, 0);
  driver.frameAt(0);
  driver.expectPending(0, 1);
  for (let frame = 1; frame <= 4; frame++) {
    const timer = [...driver.timers.values()][0];
    assert.equal(timer.delay, AMBIENT_INTERVAL);
    driver.advanceTo(timer.due - 1);
    driver.expectPending(0, 1);
    assert.equal(drawn.length, frame);
    driver.advanceTo(timer.due);
    driver.expectPending(1, 0);
    assert.equal(drawn.length, frame, 'timers schedule RAF without drawing outside the animation frame');
    driver.frameAt(timer.due);
    driver.expectPending(0, 1);
  }
  for (let i = 1; i < drawn.length; i++) {
    assert.ok(drawn[i] - drawn[i - 1] >= AMBIENT_INTERVAL - 1e-10, 'idle frames must not exceed 12 FPS');
  }
  loop.dispose();
});

test('ambient invalidation cancels its wait, coalesces immediate redraws and resumes the capped cadence', () => {
  const driver = new FakeRenderDriver();
  const drawn: number[] = [];
  const loop = new RenderLoop(time => drawn.push(time), driver);
  loop.setMode('ambient');
  driver.frameAt(0);
  driver.advanceTo(20);
  loop.invalidate(); loop.invalidate(); loop.invalidate();
  driver.expectPending(1, 0);
  driver.frameAt(25);
  assert.deepEqual(drawn, [0, 25]);
  driver.expectPending(0, 1);
  assert.equal([...driver.timers.values()][0].due, 25 + AMBIENT_INTERVAL);
  loop.dispose();
});

test('still mode draws once and sleeps until coalesced invalidations request one more frame', () => {
  const driver = new FakeRenderDriver();
  const drawn: number[] = [];
  const loop = new RenderLoop(time => drawn.push(time), driver);
  loop.setMode('still');
  driver.frameAt(16);
  driver.expectPending(0, 0);
  driver.advanceTo(60_000);
  loop.setMode('still');
  driver.expectPending(0, 0);
  loop.invalidate(); loop.invalidate(); loop.invalidate();
  driver.expectPending(1, 0);
  driver.frameAt(60_010);
  driver.expectPending(0, 0);
  assert.deepEqual(drawn, [16, 60_010]);
  loop.dispose();
});

test('an invalidation during a still draw schedules one follow-up frame without recursion', () => {
  const driver = new FakeRenderDriver();
  const drawn: number[] = [];
  const loop = new RenderLoop(time => {
    drawn.push(time);
    if (drawn.length === 1) { loop.invalidate(); loop.invalidate(); }
  }, driver);
  loop.setMode('still');
  driver.frameAt(16);
  assert.deepEqual(drawn, [16]);
  driver.expectPending(1, 0);
  driver.frameAt(32);
  assert.deepEqual(drawn, [16, 32]);
  driver.expectPending(0, 0);
  loop.dispose();
});

test('hidden and modal-obscured transitions cancel active frames and ambient timers', () => {
  for (const status of ['flying', 'ready'] as const) {
    for (const suppression of [{ visible: false }, { obscured: true }]) {
      const driver = new FakeRenderDriver();
      const drawn: number[] = [];
      const loop = new RenderLoop(time => drawn.push(time), driver);
      loop.setMode(renderModeFor({ ...visibleScene, status }));
      driver.frameAt(16);
      driver.expectPending(status === 'flying' ? 1 : 0, status === 'ready' ? 1 : 0);
      loop.setMode(renderModeFor({ ...visibleScene, status, ...suppression }));
      loop.invalidate(); loop.invalidate();
      driver.expectPending(0, 0);
      driver.advanceTo(120_000);
      driver.frameAt(120_000);
      assert.deepEqual(drawn, [16]);
      driver.expectPending(0, 0);
      // The engine pauses gameplay on suppression; uncovering draws the paused scene once.
      loop.setMode(renderModeFor({ ...visibleScene, status: 'paused' }));
      driver.frameAt(120_016);
      driver.expectPending(0, 0);
      assert.deepEqual(drawn, [16, 120_016]);
      loop.dispose();
    }
  }
});

test('suspending or disposing inside draw cannot resurrect a frame or timer', () => {
  for (const mode of ['active', 'ambient', 'still'] as const) {
    for (const action of ['suspend', 'dispose'] as const) {
      const driver = new FakeRenderDriver();
      let calls = 0;
      const loop = new RenderLoop(() => {
        calls++;
        if (action === 'dispose') loop.dispose();
        else loop.setMode('suspended');
        loop.invalidate();
      }, driver);
      loop.setMode(mode);
      driver.frameAt(16);
      driver.advanceTo(60_000);
      driver.frameAt(60_000);
      assert.equal(calls, 1, `${mode} ${action}`);
      driver.expectPending(0, 0);
      loop.dispose();
    }
  }
});

test('mode changes during draw settle into the new cadence after one invalidated follow-up', () => {
  for (const nextMode of ['still', 'ambient'] as const) {
    const driver = new FakeRenderDriver();
    let calls = 0;
    const loop = new RenderLoop(() => {
      calls++;
      if (calls === 1) loop.setMode(nextMode);
    }, driver);
    loop.setMode('active');
    driver.frameAt(16);
    driver.expectPending(1, 0);
    driver.frameAt(32);
    assert.equal(calls, 2);
    driver.expectPending(0, nextMode === 'ambient' ? 1 : 0);
    loop.dispose();
  }
});

test('dispose cancels every pending callback and rejects later invalidations or mode changes', () => {
  for (const mode of ['active', 'ambient', 'still'] as const) {
    const driver = new FakeRenderDriver();
    let calls = 0;
    const loop = new RenderLoop(() => { calls++; }, driver);
    loop.setMode(mode);
    if (mode === 'ambient') driver.frameAt(0);
    const staleFrame = [...driver.frames.values()][0];
    const staleTimer = [...driver.timers.values()][0]?.callback;
    const callsAtDisposal = calls;
    loop.dispose(); loop.dispose();
    loop.invalidate(); loop.setMode('active');
    // Defensive guards also cover an already-dispatched callback at teardown.
    staleFrame?.(60_000); staleTimer?.();
    driver.advanceTo(60_000);
    driver.expectPending(0, 0);
    assert.equal(calls, callsAtDisposal);
  }
});

test('a long pause resumes with one current timestamp and no replay of missed frames', () => {
  const driver = new FakeRenderDriver();
  const drawn: number[] = [];
  const loop = new RenderLoop(time => drawn.push(time), driver);
  loop.setMode('active');
  driver.frameAt(10);
  loop.setMode('still');
  driver.frameAt(20);
  driver.expectPending(0, 0);
  driver.advanceTo(600_000);
  loop.setMode('active');
  driver.expectPending(1, 0);
  driver.frameAt(600_000);
  assert.deepEqual(drawn, [10, 20, 600_000], 'the scheduler forwards wall timestamps; the engine resets its simulation clock separately');
  driver.expectPending(1, 0);
  driver.frameAt(600_016);
  assert.deepEqual(drawn, [10, 20, 600_000, 600_016]);
  loop.dispose();
});

test('a delayed ambient timer produces one fresh frame instead of catching up missed idle frames', () => {
  const driver = new FakeRenderDriver();
  const drawn: number[] = [];
  const loop = new RenderLoop(time => drawn.push(time), driver);
  loop.setMode('ambient');
  driver.frameAt(0);
  driver.advanceTo(600_000);
  driver.expectPending(1, 0);
  assert.deepEqual(drawn, [0]);
  driver.frameAt(600_000);
  assert.deepEqual(drawn, [0, 600_000]);
  driver.expectPending(0, 1);
  assert.equal([...driver.timers.values()][0].due, 600_000 + AMBIENT_INTERVAL);
  loop.dispose();
});

test('draw failure suspends scheduling even if the draw invalidated itself first', () => {
  const driver = new FakeRenderDriver();
  const failure = new Error('render failed');
  const loop = new RenderLoop(() => { loop.invalidate(); throw failure; }, driver);
  loop.setMode('active');
  assert.throws(() => driver.frameAt(16), error => error === failure);
  driver.expectPending(0, 0);
  loop.invalidate();
  driver.expectPending(0, 0);
  loop.dispose();
});
