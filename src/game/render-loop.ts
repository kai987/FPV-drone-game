import type { Status } from './types.ts';

export type GraphicsState = 'ready' | 'lost' | 'restoring' | 'failed';
export type RenderMode = 'active' | 'ambient' | 'still' | 'suspended';

export function renderModeFor(state: {
  prepared: boolean; visible: boolean; obscured: boolean; graphics: GraphicsState; status: Status;
}): RenderMode {
  if (!state.prepared || !state.visible || state.obscured || state.graphics === 'lost' || state.graphics === 'failed') return 'suspended';
  if (state.graphics === 'restoring') return 'still';
  return state.status === 'flying' ? 'active' : state.status === 'ready' ? 'ambient' : 'still';
}

export interface RenderDriver {
  frame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  timer(callback: () => void, delay: number): number;
  cancelTimer(handle: number): void;
}

const browserDriver: RenderDriver = {
  frame: callback => requestAnimationFrame(callback),
  cancelFrame: handle => cancelAnimationFrame(handle),
  timer: (callback, delay) => window.setTimeout(callback, delay),
  cancelTimer: handle => window.clearTimeout(handle),
};

/** One scheduling owner: full rate in flight, 12 FPS idle, no polling while paused or obscured. */
export class RenderLoop {
  private mode: RenderMode = 'suspended';
  private frame?: number;
  private timer?: number;
  private drawing = false;
  private dirty = false;
  private disposed = false;
  private readonly draw: (time: number) => void;
  private readonly driver: RenderDriver;

  constructor(draw: (time: number) => void, driver: RenderDriver = browserDriver) {
    this.draw = draw; this.driver = driver;
  }

  setMode(mode: RenderMode) {
    if (this.disposed || this.mode === mode) return;
    this.mode = mode;
    this.cancelPending();
    this.invalidate();
  }

  invalidate() {
    if (this.disposed) return;
    this.dirty = true;
    if (this.mode === 'suspended' || this.drawing) return;
    if (this.timer !== undefined) this.driver.cancelTimer(this.timer);
    this.timer = undefined;
    this.requestFrame();
  }

  private requestFrame() {
    if (this.frame === undefined && !this.disposed && this.mode !== 'suspended') this.frame = this.driver.frame(this.tick);
  }

  private get stopped() { return this.disposed || this.mode === 'suspended'; }

  private tick = (time: number) => {
    this.frame = undefined;
    if (this.stopped) return;
    this.dirty = false;
    this.drawing = true;
    try { this.draw(time); }
    catch (error) { this.mode = 'suspended'; this.cancelPending(); throw error; }
    finally { this.drawing = false; }
    if (this.stopped) return;
    if (this.mode === 'active' || this.dirty) this.requestFrame();
    else if (this.mode === 'ambient') this.timer = this.driver.timer(() => {
      this.timer = undefined;
      this.requestFrame();
    }, 1000 / 12);
  };

  private cancelPending() {
    if (this.frame !== undefined) this.driver.cancelFrame(this.frame);
    if (this.timer !== undefined) this.driver.cancelTimer(this.timer);
    this.frame = this.timer = undefined;
  }

  dispose() { this.disposed = true; this.cancelPending(); }
}
