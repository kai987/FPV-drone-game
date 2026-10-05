export type TouchFlightAxis = 'forward' | 'strafe' | 'climb' | 'yaw';
export type TouchFlightAxes = Record<TouchFlightAxis, number>;
export type TouchGestureRole = 'flight' | 'attitude';

export interface GestureFinger {
  id: number;
  role: TouchGestureRole;
  originX: number;
  originY: number;
  x: number;
  y: number;
  pressedAt: number;
}

export interface TouchGestureSnapshot {
  axes: TouchFlightAxes;
  fingers: readonly GestureFinger[];
  throttle: number;
}

export const TOUCH_GESTURE_RAMP_MS = 2_000;
export const TOUCH_GESTURE_DEAD_ZONE = 12;
export const TOUCH_GESTURE_RADIUS = 76;
const INITIAL_THROTTLE = 0.16;
const AXIS_SLEW_PER_SECOND = 2.6;
const ZERO: Readonly<TouchFlightAxes> = { forward: 0, strafe: 0, climb: 0, yaw: 0 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function displacement(value: number) {
  const distance = Math.abs(value);
  return distance <= TOUCH_GESTURE_DEAD_ZONE ? 0
    : Math.sign(value) * clamp((distance - TOUCH_GESTURE_DEAD_ZONE) / (TOUCH_GESTURE_RADIUS - TOUCH_GESTURE_DEAD_ZONE), 0, 1);
}

function throttleAt(finger: GestureFinger, now: number) {
  const fraction = clamp((now - finger.pressedAt) / TOUCH_GESTURE_RAMP_MS, 0, 1);
  const eased = fraction * fraction * (3 - 2 * fraction);
  return INITIAL_THROTTLE + (1 - INITIAL_THROTTLE) * eased;
}

function approach(current: number, target: number, step: number) {
  // A reversed drag brakes through zero before applying thrust in the new direction.
  const nextTarget = current * target < 0 ? 0 : target;
  return current + clamp(nextTarget - current, -step, step);
}

/** Two independently owned pointer roles; a remaining finger is never promoted. */
export class TouchGestureController {
  private flight: GestureFinger | null = null;
  private attitude: GestureFinger | null = null;
  private axes: TouchFlightAxes = { ...ZERO };
  private lastSampleAt: number | null = null;

  get active() {
    return this.flight !== null || this.attitude !== null;
  }

  get pointerIds(): readonly number[] {
    return [this.flight, this.attitude].filter((finger): finger is GestureFinger => finger !== null).map(finger => finger.id);
  }

  begin(id: number, x: number, y: number, now: number): boolean {
    if (![id, x, y, now].every(Number.isFinite) || this.pointerIds.includes(id) || (this.flight && this.attitude)) return false;
    const role = this.flight === null ? 'flight' : 'attitude';
    const finger: GestureFinger = { id, role, originX: x, originY: y, x, y, pressedAt: now };
    if (role === 'flight') this.flight = finger;
    else this.attitude = finger;
    if (this.lastSampleAt === null) this.lastSampleAt = now;
    return true;
  }

  move(id: number, x: number, y: number): boolean {
    if (![x, y].every(Number.isFinite)) return false;
    const finger = this.flight?.id === id ? this.flight : this.attitude?.id === id ? this.attitude : null;
    if (!finger) return false;
    finger.x = x;
    finger.y = y;
    return true;
  }

  end(id: number): boolean {
    if (this.flight?.id === id) {
      this.flight = null;
      this.axes.forward = 0;
      this.axes.strafe = 0;
    } else if (this.attitude?.id === id) {
      this.attitude = null;
      this.axes.climb = 0;
      this.axes.yaw = 0;
    } else return false;
    if (!this.active) this.lastSampleAt = null;
    return true;
  }

  reset(): void {
    this.flight = null;
    this.attitude = null;
    this.axes = { ...ZERO };
    this.lastSampleAt = null;
  }

  snapshot(now: number): TouchGestureSnapshot {
    return {
      axes: { ...this.axes },
      fingers: [this.flight, this.attitude].filter((finger): finger is GestureFinger => finger !== null).map(finger => ({ ...finger })),
      throttle: this.flight ? throttleAt(this.flight, Number.isFinite(now) ? now : this.flight.pressedAt) : 0,
    };
  }

  sample(now: number): TouchGestureSnapshot {
    if (!Number.isFinite(now)) return this.snapshot(this.lastSampleAt ?? 0);
    const delta = this.lastSampleAt === null ? 0 : clamp((now - this.lastSampleAt) / 1_000, 0, 1 / 15);
    this.lastSampleAt = this.active ? Math.max(now, this.lastSampleAt ?? now) : null;
    const target = { ...ZERO };
    if (this.flight) {
      const horizontal = displacement(this.flight.x - this.flight.originX);
      const vertical = displacement(this.flight.originY - this.flight.y);
      // Blend from forward cruising to the dragged direction without a jump at
      // the dead zone. Upward travel preserves cruising; downward travel brakes
      // through neutral, while a full sideways drag remains a pure strafe.
      const cruising = 1 - Math.abs(horizontal);
      const forward = cruising * (1 - Math.abs(vertical)) + vertical;
      const length = Math.max(1, Math.hypot(forward, horizontal));
      const throttle = throttleAt(this.flight, now);
      target.forward = forward / length * throttle;
      target.strafe = horizontal / length * throttle;
    }
    if (this.attitude) {
      target.climb = displacement(this.attitude.originY - this.attitude.y);
      target.yaw = -displacement(this.attitude.x - this.attitude.originX);
    }
    const step = AXIS_SLEW_PER_SECOND * delta;
    for (const axis of Object.keys(ZERO) as TouchFlightAxis[]) {
      this.axes[axis] = approach(this.axes[axis], target[axis], step);
    }
    const horizontalSpeed = Math.hypot(this.axes.forward, this.axes.strafe);
    if (horizontalSpeed > 1) {
      this.axes.forward /= horizontalSpeed;
      this.axes.strafe /= horizontalSpeed;
    }
    return this.snapshot(now);
  }
}
