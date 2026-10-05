import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderPerformanceMonitor } from '../src/game/render-performance.ts';
import type { RendererPerformanceInfo } from '../src/game/render-performance.ts';

const info: RendererPerformanceInfo = {
  render: { calls: 84, triangles: 125_600 },
  memory: { geometries: 36, textures: 18 },
};

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

function clock(monitor: RenderPerformanceMonitor, initialTime = 0) {
  let now = initialTime;
  monitor.recordFrame(now, 2, 3, 4, info);
  return {
    get now() { return now; },
    frames(count: number, interval = 20, cpu: readonly [number, number, number] = [2, 3, 4], eligible = true) {
      const changes: { time: number; pixelRatio: number }[] = [];
      for (let frame = 0; frame < count; frame++) {
        now += interval;
        const changed = monitor.recordFrame(now, cpu[0], cpu[1], cpu[2], info, eligible);
        if (changed !== undefined) changes.push({ time: now, pixelRatio: changed });
      }
      return changes;
    },
    jump(duration: number, eligible = true) {
      now += duration;
      return monitor.recordFrame(now, 2, 3, 4, info, eligible);
    },
  };
}

test('initial quality respects device DPR and selects a mobile or desktop frame budget', () => {
  for (const [devicePixelRatio, expected] of [[3, 1.75], [1.3, 1.3], [1, 1], [0.8, 0.8], [NaN, 1], [0, 1]]) {
    const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio });
    assert.equal(monitor.pixelRatio, expected);
    assert.equal(monitor.snapshot().pixelRatio, expected);
    assert.equal(monitor.targetFps, 30);
  }
  assert.equal(new RenderPerformanceMonitor({ isMobile: false, devicePixelRatio: 2 }).targetFps, 60);
});

test('reports RAF pacing, CPU segments and renderer counters without replacing the snapshot every frame', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  const time = clock(monitor, 20_000);
  const initial = monitor.snapshot();
  time.frames(75); // 1.5-second warmup.
  assert.equal(monitor.snapshot(), initial);
  time.frames(49);
  assert.equal(monitor.snapshot(), initial);
  time.frames(1);
  const report = monitor.snapshot();
  assert.notEqual(report, initial);
  near(report.fps, 50);
  near(report.frameMs, 20);
  near(report.frameP95Ms, 20);
  near(report.simulationMs, 2);
  near(report.sceneMs, 3);
  near(report.renderSubmissionMs, 4);
  assert.equal(report.drawCalls, 84);
  assert.equal(report.triangles, 125_600);
  assert.equal(report.geometries, 36);
  assert.equal(report.textures, 18);
  assert.equal(report.sampledFrames, 50);
  assert.equal(report.sampleDurationMs, 1_000);
  assert.equal(report.sampledAt, time.now);
  time.frames(1);
  assert.equal(monitor.snapshot(), report);
});

test('the percentile reflects slow frames rather than only the mean', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  const time = clock(monitor);
  time.frames(75);
  time.frames(40, 20);
  time.frames(5, 40);
  const report = monitor.snapshot();
  assert.equal(report.sampledFrames, 45);
  near(report.frameMs, 1_000 / 45);
  near(report.fps, 45);
  near(report.frameP95Ms, 40);
});

test('sustained poor pacing reduces one quality level after three sampled seconds', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: false, devicePixelRatio: 3 });
  const time = clock(monitor);
  assert.deepEqual(time.frames(179, 25), []);
  assert.deepEqual(time.frames(1, 25), [{ time: 4_500, pixelRatio: 1.5 }]);
  assert.equal(monitor.pixelRatio, 1.5);
  assert.equal(monitor.snapshot().pixelRatio, 1.5);
  assert.equal(monitor.snapshot().measuredPixelRatio, 1.75);
  assert.deepEqual(time.frames(200, 25), [], 'five-second cooldown cannot trigger another change');
  const later = time.frames(120, 25);
  assert.equal(later.length, 1);
  assert.equal(later[0].pixelRatio, 1.25);
});

test('a mobile 30 FPS stream remains at full quality while desktop 30 FPS steps down', () => {
  const mobile = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  const desktop = new RenderPerformanceMonitor({ isMobile: false, devicePixelRatio: 2 });
  assert.deepEqual(clock(mobile).frames(300, 1_000 / 30), []);
  assert.ok(clock(desktop).frames(300, 1_000 / 30).length >= 1);
  assert.equal(mobile.pixelRatio, 1.75);
});

test('a single bad window cannot trigger a quality reduction', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  const time = clock(monitor);
  time.frames(75);
  assert.deepEqual(time.frames(20, 50), []);
  assert.deepEqual(time.frames(50, 20), []);
  assert.deepEqual(time.frames(40, 50), []);
  assert.equal(monitor.pixelRatio, 1.75, 'a healthy window breaks the slow-frame streak');
});

test('a persistently slow 3 FPS stream still lowers quality instead of being discarded as a loading gap', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  const changes = clock(monitor).frames(30, 1_000 / 3);
  assert.ok(changes.length >= 1);
  assert.equal(changes[0].pixelRatio, 1.5);
  near(monitor.snapshot().fps, 3);
});

test('long stalls and lifecycle resets discard incomplete slow streaks and require fresh warmup', () => {
  for (const interrupt of ['stall', 'reset', 'paused', 'hidden'] as const) {
    const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
    const time = clock(monitor, 100_000);
    time.frames(70, 50); // Warmup plus two seconds of poor pacing.
    if (interrupt === 'stall') assert.equal(time.jump(4_000), undefined);
    else if (interrupt === 'reset') monitor.reset();
    else time.frames(20, 100, [2, 3, 4], false);
    assert.deepEqual(time.frames(69, 50), []);
    assert.equal(monitor.pixelRatio, 1.75, `${interrupt} must not count toward sustained poor pacing`);
    assert.ok(monitor.snapshot().fps <= 30);
  }
});

test('quality increases only after cooldown and twelve stable seconds with CPU submission headroom', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  const time = clock(monitor);
  assert.equal(time.frames(90, 50).at(-1)?.pixelRatio, 1.5);
  assert.deepEqual(time.frames(800, 20), []); // Five-second cooldown plus eleven healthy seconds.
  assert.equal(time.frames(100, 20).at(-1)?.pixelRatio, 1.75);
  assert.equal(monitor.pixelRatio, 1.75);
});

test('CPU-bound frames and irregular pacing cannot be mistaken for quality headroom', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  const time = clock(monitor);
  time.frames(90, 50);
  assert.deepEqual(time.frames(1_500, 20, [10, 10, 10]), []);
  assert.equal(monitor.pixelRatio, 1.5);
  for (let second = 0; second < 20; second++) {
    assert.deepEqual(time.frames(40, 20), []);
    assert.deepEqual(time.frames(4, 50), []);
  }
  assert.equal(monitor.pixelRatio, 1.5, 'p95 spikes break the upgrade streak despite a healthy average');
});

test('quality remains bounded and never requests a DPR above the actual device ratio', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 1.3 });
  const time = clock(monitor);
  const drops = time.frames(800, 50);
  assert.deepEqual(drops.map(change => change.pixelRatio), [1.25, 1]);
  assert.equal(monitor.pixelRatio, 1);
  const rises = time.frames(4_000, 20);
  assert.deepEqual(rises.map(change => change.pixelRatio), [1.25, 1.3]);
  assert.equal(monitor.pixelRatio, 1.3);
});

test('invalid timestamps and backwards clocks do not poison future reports', () => {
  const monitor = new RenderPerformanceMonitor({ isMobile: true, devicePixelRatio: 2 });
  monitor.recordFrame(100, 2, 3, 4, info);
  monitor.recordFrame(NaN, 2, 3, 4, info);
  monitor.recordFrame(50, 2, 3, 4, info);
  monitor.recordFrame(40, 2, 3, 4, info);
  const time = clock(monitor, 40);
  time.frames(125, 20);
  const report = monitor.snapshot();
  near(report.fps, 50);
  assert.ok(Object.values(report).every(Number.isFinite));
});
