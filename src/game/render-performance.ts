/** CPU measurements and RAF pacing; these values do not measure GPU execution time. */
export interface RenderPerformanceSnapshot {
  fps: number;
  frameMs: number;
  frameP95Ms: number;
  simulationMs: number;
  sceneMs: number;
  renderSubmissionMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  sampledFrames: number;
  sampleDurationMs: number;
  sampledAt: number;
  /** The setting currently requested from the renderer. */
  pixelRatio: number;
  /** The setting used by the frames in this report, before any quality change. */
  measuredPixelRatio: number;
  targetFps: number;
}

/** Structurally compatible with THREE.WebGLRenderer.info; no adapter allocation is needed. */
export interface RendererPerformanceInfo {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

export interface RenderPerformanceOptions {
  isMobile: boolean;
  devicePixelRatio: number;
}

const SAMPLE_WINDOW_MS = 1_000;
const WARMUP_MS = 1_500;
// Keep genuinely slow streams (including 3 FPS) measurable. Lifecycle changes
// are reset explicitly; only multi-second suspension/loading gaps are excluded.
const LONG_FRAME_MS = 1_000;
const DOWNGRADE_MS = 3_000;
const UPGRADE_MS = 12_000;
const QUALITY_COOLDOWN_MS = 5_000;
const PIXEL_RATIO_LEVELS = [1, 1.25, 1.5, 1.75] as const;

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Feed one completed, visible flying frame at a time. Scalar totals and a fixed
 * buffer avoid per-frame allocations. Reports are replaced about once a second.
 *
 * Call reset() on start/resume/map changes; ineligible frames also break the
 * sampling sequence. A long stall is excluded and starts a fresh warmup. Quality
 * is reduced only after sustained poor pacing, and raised cautiously after both
 * stable pacing and low CPU submission cost. Raising quality is a measured trial,
 * since low CPU cost cannot prove GPU headroom on a vsync-limited display.
 */
export class RenderPerformanceMonitor {
  readonly targetFps: number;
  private readonly levels: number[];
  private level: number;
  private lastFrameTime: number | undefined;
  private warmupRemaining = WARMUP_MS;
  private cooldownRemaining = 0;
  private slowDuration = 0;
  private headroomDuration = 0;
  private frameSamples = new Float64Array(512);
  private frameCount = 0;
  private windowDuration = 0;
  private windowCooling = false;
  private simulationTotal = 0;
  private sceneTotal = 0;
  private submissionTotal = 0;
  private latest: Readonly<RenderPerformanceSnapshot>;

  constructor({ isMobile, devicePixelRatio }: RenderPerformanceOptions) {
    this.targetFps = isMobile ? 30 : 60;
    const maximum = Math.min(Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1, 1.75);
    this.levels = [...new Set(PIXEL_RATIO_LEVELS.map(ratio => Math.min(ratio, maximum)))];
    this.level = this.levels.length - 1;
    this.latest = {
      fps: 0, frameMs: 0, frameP95Ms: 0, simulationMs: 0, sceneMs: 0, renderSubmissionMs: 0,
      drawCalls: 0, triangles: 0, geometries: 0, textures: 0, sampledFrames: 0,
      sampleDurationMs: 0, sampledAt: 0, pixelRatio: this.pixelRatio,
      measuredPixelRatio: this.pixelRatio, targetFps: this.targetFps,
    };
  }

  get pixelRatio(): number { return this.levels[this.level]; }

  /** The same object is returned until a new sampling window completes. */
  snapshot(): Readonly<RenderPerformanceSnapshot> { return this.latest; }

  /** Keep current quality and the last report, but discard incomplete measurements and streaks. */
  reset(): void {
    this.lastFrameTime = undefined;
    this.warmupRemaining = WARMUP_MS;
    this.slowDuration = 0;
    this.headroomDuration = 0;
    this.clearWindow();
  }

  /** Returns a new DPR only when the renderer should resize; otherwise returns undefined. */
  recordFrame(timeMs: number, simulationMs: number, sceneMs: number, renderSubmissionMs: number,
    info: RendererPerformanceInfo, eligible = true): number | undefined {
    if (!eligible || !Number.isFinite(timeMs)) {
      // Paused/hidden animation loops may call this repeatedly: reset only once.
      if (this.lastFrameTime !== undefined) this.reset();
      return undefined;
    }
    const previousTime = this.lastFrameTime;
    this.lastFrameTime = timeMs;
    if (previousTime === undefined) return undefined;
    const interval = timeMs - previousTime;
    if (interval === 0) return undefined;
    if (interval < 0 || interval > LONG_FRAME_MS) {
      this.reset();
      this.lastFrameTime = timeMs;
      return undefined;
    }
    const cooling = this.cooldownRemaining > 0;
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - interval);
    if (this.warmupRemaining > 0) {
      this.warmupRemaining = Math.max(0, this.warmupRemaining - interval);
      return undefined;
    }
    this.frameSamples[this.frameCount % this.frameSamples.length] = interval;
    this.frameCount++;
    this.windowDuration += interval;
    this.windowCooling ||= cooling;
    this.simulationTotal += nonNegative(simulationMs);
    this.sceneTotal += nonNegative(sceneMs);
    this.submissionTotal += nonNegative(renderSubmissionMs);
    if (this.windowDuration < SAMPLE_WINDOW_MS) return undefined;

    const measuredPixelRatio = this.pixelRatio;
    const frameMs = this.windowDuration / this.frameCount;
    // Sorting is limited to the once-per-window report, not the RAF loop.
    const samples = this.frameSamples.slice(0, Math.min(this.frameCount, this.frameSamples.length)).sort();
    const frameP95Ms = samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)];
    const simulationAverage = this.simulationTotal / this.frameCount;
    const sceneAverage = this.sceneTotal / this.frameCount;
    const submissionAverage = this.submissionTotal / this.frameCount;
    const change = this.evaluateQuality(frameMs, frameP95Ms, simulationAverage + sceneAverage + submissionAverage);
    this.latest = {
      fps: 1_000 / frameMs, frameMs, frameP95Ms,
      simulationMs: simulationAverage, sceneMs: sceneAverage, renderSubmissionMs: submissionAverage,
      drawCalls: nonNegative(info.render.calls), triangles: nonNegative(info.render.triangles),
      geometries: nonNegative(info.memory.geometries), textures: nonNegative(info.memory.textures),
      sampledFrames: this.frameCount, sampleDurationMs: this.windowDuration, sampledAt: timeMs,
      pixelRatio: this.pixelRatio, measuredPixelRatio, targetFps: this.targetFps,
    };
    this.clearWindow();
    return change;
  }

  private clearWindow(): void {
    this.frameCount = 0;
    this.windowDuration = 0;
    this.windowCooling = false;
    this.simulationTotal = 0;
    this.sceneTotal = 0;
    this.submissionTotal = 0;
  }

  private evaluateQuality(frameMs: number, frameP95Ms: number, cpuMs: number): number | undefined {
    const budget = 1_000 / this.targetFps;
    if (this.windowCooling || this.cooldownRemaining > 0) {
      this.slowDuration = 0;
      this.headroomDuration = 0;
      return undefined;
    }
    const slow = frameMs > budget * 1.25;
    const headroom = frameMs <= budget / 0.95 && frameP95Ms <= budget * 1.2 && cpuMs <= budget * 0.65;
    this.slowDuration = slow ? this.slowDuration + this.windowDuration : 0;
    this.headroomDuration = headroom ? this.headroomDuration + this.windowDuration : 0;
    let nextLevel = this.level;
    if (this.slowDuration >= DOWNGRADE_MS && this.level > 0) nextLevel--;
    else if (this.headroomDuration >= UPGRADE_MS && this.level < this.levels.length - 1) nextLevel++;
    if (nextLevel === this.level) return undefined;
    this.level = nextLevel;
    this.cooldownRemaining = QUALITY_COOLDOWN_MS;
    this.slowDuration = 0;
    this.headroomDuration = 0;
    return this.pixelRatio;
  }
}
