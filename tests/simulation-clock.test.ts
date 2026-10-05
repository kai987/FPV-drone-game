import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FixedSimulationClock, MAX_SIMULATION_STEPS_PER_TICK, SIMULATION_STEP_SECONDS,
} from '../src/game/simulation-clock.ts';

function near(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
}

test('10, 20, 30, 60 and 120 FPS advance every subsystem by the same fixed simulation time', () => {
  for (const fps of [10, 20, 30, 60, 120]) {
    const clock = new FixedSimulationClock();
    clock.reset(0);
    let calls = 0, flight = 0, wind = 0, weapons = 0, timer = 0;
    for (let frame = 1; frame <= fps * 3; frame++) {
      const result = clock.tick(frame * 1000 / fps, dt => {
        assert.equal(dt, SIMULATION_STEP_SECONDS);
        calls++;
        flight += dt; wind += dt; weapons += dt; timer += dt;
      });
      assert.equal(result.droppedSeconds, 0);
      assert.ok(result.steps <= MAX_SIMULATION_STEPS_PER_TICK);
      assert.ok(result.alpha >= 0 && result.alpha < 1);
    }
    assert.equal(calls, 180, `${fps} FPS must produce 180 simulation steps`);
    for (const [system, elapsed] of Object.entries({ flight, wind, weapons, timer })) {
      near(elapsed, 3, `${fps} FPS ${system}`);
    }
  }
});

test('the first frame establishes the origin without advancing gameplay', () => {
  const clock = new FixedSimulationClock();
  let calls = 0;
  assert.deepEqual(clock.tick(12_345, () => { calls++; }), {
    steps: 0, advancedSeconds: 0, droppedSeconds: 0, alpha: 0,
  });
  assert.equal(calls, 0);
  assert.equal(clock.tick(12_345 + 1000 / 60, () => { calls++; }).steps, 1);
  assert.equal(calls, 1);
});

test('substep frames retain only a fractional step for render interpolation', () => {
  const clock = new FixedSimulationClock();
  clock.reset(0);
  const first = clock.tick(1000 / 120, () => assert.fail('Half a step must not simulate'));
  assert.equal(first.steps, 0);
  near(first.alpha, 0.5, 'half-step alpha');
  const second = clock.tick(1000 / 60, () => {});
  assert.equal(second.steps, 1);
  near(second.alpha, 0, 'completed-step alpha');
});

test('reset on pause and resume removes fractional time and does not catch up background time', () => {
  const clock = new FixedSimulationClock();
  clock.reset(0);
  clock.tick(10, () => assert.fail('A partial step must not simulate'));
  clock.reset(60_000);
  assert.equal(clock.tick(60_000, () => assert.fail('Resume must not catch up')).alpha, 0);
  let advanced = 0;
  const resumed = clock.tick(60_000 + 1000 / 60, dt => { advanced += dt; });
  assert.equal(resumed.steps, 1);
  near(advanced, SIMULATION_STEP_SECONDS, 'resumed simulation time');
  assert.equal(resumed.droppedSeconds, 0);
  clock.reset();
  assert.equal(clock.tick(120_000, () => assert.fail('Reset without a timestamp must reanchor')).steps, 0);
});

test('nonfinite timestamps clear accumulated time and require a new finite origin', () => {
  for (const invalid of [Number.NaN, Infinity, -Infinity]) {
    const clock = new FixedSimulationClock();
    clock.reset(100);
    clock.tick(110, () => assert.fail('A partial step must not simulate'));
    assert.deepEqual(clock.tick(invalid, () => assert.fail('Invalid time must not simulate')), {
      steps: 0, advancedSeconds: 0, droppedSeconds: 0, alpha: 0,
    });
    assert.equal(clock.tick(50_000, () => assert.fail('The next valid frame must reanchor')).steps, 0);
    assert.equal(clock.tick(50_000 + 1000 / 60, () => {}).steps, 1);
  }
});

test('a clock moving backwards reanchors and repeated timestamps never advance time', () => {
  const clock = new FixedSimulationClock();
  clock.reset(100);
  clock.tick(110, () => assert.fail('A partial step must not simulate'));
  const backward = clock.tick(50, () => assert.fail('Backwards time must not simulate'));
  assert.equal(backward.alpha, 0);
  assert.equal(backward.steps, 0);
  assert.equal(clock.tick(50, () => assert.fail('Repeated time must not simulate')).steps, 0);
  assert.equal(clock.tick(50 + 1000 / 60, () => {}).steps, 1);
});

test('overflowing the difference between finite timestamps cannot enter the simulation or metrics', () => {
  const clock = new FixedSimulationClock();
  clock.reset(-Number.MAX_VALUE);
  assert.deepEqual(clock.tick(Number.MAX_VALUE, () => assert.fail('Overflowed time must not simulate')), {
    steps: 0, advancedSeconds: 0, droppedSeconds: 0, alpha: 0,
  });
});

test('a long stall advances at most 15 steps and discarded time is never replayed', () => {
  const clock = new FixedSimulationClock();
  clock.reset(0);
  let calls = 0;
  const stalled = clock.tick(10_000, dt => {
    calls++;
    assert.equal(dt, SIMULATION_STEP_SECONDS);
  });
  assert.equal(calls, MAX_SIMULATION_STEPS_PER_TICK);
  assert.equal(stalled.steps, 15);
  near(stalled.advancedSeconds, 0.25, 'bounded catch-up');
  near(stalled.droppedSeconds, 9.75, 'discarded stall time');
  near(stalled.alpha, 0, 'no catch-up backlog');
  assert.equal(clock.tick(10_000 + 1000 / 60, () => { calls++; }).steps, 1);
  assert.equal(calls, 16);
});

test('a stall preserves an existing fractional step but never exceeds the step budget', () => {
  const clock = new FixedSimulationClock();
  clock.reset(0);
  clock.tick(10, () => assert.fail('A partial step must not simulate'));
  const stalled = clock.tick(10_010, () => {});
  assert.equal(stalled.steps, 15);
  near(stalled.alpha, 0.6, 'existing partial step remains');
  near(stalled.droppedSeconds, 9.75, 'stall budget excludes the retained fraction');
  assert.equal(clock.tick(10_020, () => {}).steps, 1);
});

test('a completed race can stop catch-up immediately without carrying steps into the next frame', () => {
  const clock = new FixedSimulationClock();
  clock.reset(0);
  let calls = 0;
  const finished = clock.tick(100, () => {
    calls++;
    if (calls === 2) return false;
  });
  assert.equal(calls, 2);
  assert.equal(finished.steps, 2);
  near(finished.advancedSeconds, 2 / 60, 'completed steps count');
  near(finished.droppedSeconds, 0.1 - 2 / 60, 'unfinished tick remainder is discarded');
  assert.equal(finished.alpha, 0);
  assert.equal(clock.tick(100 + 1000 / 60, () => {}).steps, 1);
});

test('a custom catch-up budget remains fixed and rejects invalid settings', () => {
  const clock = new FixedSimulationClock({ stepSeconds: 0.02, maxStepsPerTick: 3 });
  clock.reset(0);
  const result = clock.tick(100, dt => assert.equal(dt, 0.02));
  assert.equal(result.steps, 3);
  near(result.advancedSeconds, 0.06, 'custom catch-up');
  near(result.droppedSeconds, 0.04, 'custom discarded time');
  for (const stepSeconds of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => new FixedSimulationClock({ stepSeconds }), RangeError);
  }
  for (const maxStepsPerTick of [0, -1, 1.5, Number.NaN, Infinity]) {
    assert.throws(() => new FixedSimulationClock({ maxStepsPerTick }), RangeError);
  }
});
