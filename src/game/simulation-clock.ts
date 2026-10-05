export const SIMULATION_STEP_SECONDS = 1 / 60;
export const MAX_SIMULATION_STEPS_PER_TICK = 15;

export interface SimulationClockOptions {
  stepSeconds?: number;
  maxStepsPerTick?: number;
}

export interface SimulationTick {
  steps: number;
  advancedSeconds: number;
  droppedSeconds: number;
  /** Fraction of a simulation step retained for render interpolation. */
  alpha: number;
}

/**
 * All gameplay systems share this fixed step. Long stalls discard the same
 * excess time for every system instead of leaving an ever-growing backlog.
 * Reset on pause/resume so time spent in the background is never simulated.
 */
export class FixedSimulationClock {
  readonly stepSeconds: number;
  readonly maxStepsPerTick: number;
  private previousTimeMs: number | null = null;
  private accumulatorSeconds = 0;

  constructor(options: SimulationClockOptions = {}) {
    this.stepSeconds = options.stepSeconds ?? SIMULATION_STEP_SECONDS;
    this.maxStepsPerTick = options.maxStepsPerTick ?? MAX_SIMULATION_STEPS_PER_TICK;
    if (!Number.isFinite(this.stepSeconds) || this.stepSeconds <= 0
      || !Number.isSafeInteger(this.maxStepsPerTick) || this.maxStepsPerTick <= 0
      || !Number.isFinite(this.stepSeconds * this.maxStepsPerTick)) {
      throw new RangeError('Invalid simulation clock step or catch-up budget');
    }
  }

  /** Omit the timestamp to let the next animation frame establish the origin. */
  reset(nowMs?: number): void {
    this.previousTimeMs = nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : null;
    this.accumulatorSeconds = 0;
  }

  /** Returning false from onStep stops this tick and discards its remainder. */
  tick(nowMs: number, onStep: (dt: number) => void | boolean): SimulationTick {
    if (!Number.isFinite(nowMs)) {
      this.reset();
      return this.result(0, 0);
    }
    if (this.previousTimeMs === null || nowMs < this.previousTimeMs) {
      this.reset(nowMs);
      return this.result(0, 0);
    }

    const elapsedSeconds = (nowMs - this.previousTimeMs) / 1000;
    if (!Number.isFinite(elapsedSeconds)) {
      this.reset(nowMs);
      return this.result(0, 0);
    }
    this.previousTimeMs = nowMs;
    const acceptedSeconds = Math.min(elapsedSeconds, this.stepSeconds * this.maxStepsPerTick);
    let droppedSeconds = elapsedSeconds - acceptedSeconds;
    this.accumulatorSeconds += acceptedSeconds;
    let steps = 0;
    // RAF timestamps and step subtraction introduce tiny floating-point errors.
    // The tolerance is relative to the step and never creates a backlog.
    const epsilon = this.stepSeconds * 1e-8;
    while (steps < this.maxStepsPerTick && this.accumulatorSeconds + epsilon >= this.stepSeconds) {
      this.accumulatorSeconds = Math.max(0, this.accumulatorSeconds - this.stepSeconds);
      steps++;
      if (onStep(this.stepSeconds) === false) {
        droppedSeconds += this.accumulatorSeconds;
        this.accumulatorSeconds = 0;
        break;
      }
    }
    return this.result(steps, droppedSeconds);
  }

  private result(steps: number, droppedSeconds: number): SimulationTick {
    return {
      steps,
      advancedSeconds: steps * this.stepSeconds,
      droppedSeconds,
      alpha: Math.min(1, this.accumulatorSeconds / this.stepSeconds),
    };
  }
}
