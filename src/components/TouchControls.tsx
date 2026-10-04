import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { Hand, Move, RotateCw } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { TouchGestureController, TOUCH_GESTURE_RADIUS } from './touch-gesture';
import type { TouchFlightAxes, TouchFlightAxis, TouchGestureSnapshot } from './touch-gesture';
import './TouchControls.css';

interface TouchControlsProps {
  onAxis: (axis: TouchFlightAxis, value: number) => void;
}

const AXES: TouchFlightAxis[] = ['forward', 'strafe', 'climb', 'yaw'];
const GESTURE_MEDIA = '(max-width: 980px), (pointer: coarse)';

export default function TouchControls({ onAxis }: TouchControlsProps) {
  const { t } = useI18n();
  const controllerRef = useRef<TouchGestureController | null>(null);
  if (controllerRef.current === null) controllerRef.current = new TouchGestureController();
  const controller = controllerRef.current;
  const surface = useRef<HTMLDivElement>(null);
  const callback = useRef(onAxis);
  const published = useRef<TouchFlightAxes>({ forward: 0, strafe: 0, climb: 0, yaw: 0 });
  const frame = useRef<number | null>(null);
  const alive = useRef(false);
  const lastVisualAt = useRef(0);
  const [enabled, setEnabled] = useState(() => window.matchMedia(GESTURE_MEDIA).matches);
  const [visual, setVisual] = useState<TouchGestureSnapshot>(() => controller.snapshot(0));
  useLayoutEffect(() => { callback.current = onAxis; }, [onAxis]);

  function publish(axes: TouchFlightAxes) {
    for (const axis of AXES) {
      if (published.current[axis] !== axes[axis]) {
        published.current[axis] = axes[axis];
        callback.current(axis, axes[axis]);
      }
    }
  }

  function stopFrame() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }

  function reset(updateVisual = true) {
    const ids = controller.pointerIds;
    stopFrame();
    controller.reset();
    const snapshot = controller.snapshot(0);
    publish(snapshot.axes);
    for (const id of ids) {
      try { if (surface.current?.hasPointerCapture(id)) surface.current.releasePointerCapture(id); }
      catch { /* Safari may have already released a cancelled pointer. */ }
    }
    if (updateVisual && alive.current) setVisual(snapshot);
  }

  function tick(now: number) {
    frame.current = null;
    if (!alive.current || !controller.active) return;
    const snapshot = controller.sample(now);
    publish(snapshot.axes);
    if (now - lastVisualAt.current >= 32) {
      lastVisualAt.current = now;
      setVisual(snapshot);
    }
    // A callback can synchronously stop/unmount the controls.
    if (alive.current && controller.active) frame.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    alive.current = true;
    const media = window.matchMedia(GESTURE_MEDIA);
    const updateMedia = () => {
      setEnabled(media.matches);
      if (!media.matches) reset();
    };
    const blur = () => reset();
    const visibility = () => { if (document.hidden) reset(); };
    media.addEventListener('change', updateMedia);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    window.addEventListener('orientationchange', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      media.removeEventListener('change', updateMedia);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
      window.removeEventListener('orientationchange', blur);
      document.removeEventListener('visibilitychange', visibility);
      reset(false);
    };
  }, []);

  function position(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function press(event: PointerEvent<HTMLDivElement>) {
    if (!alive.current || !enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const { x, y } = position(event);
    if (!controller.begin(event.pointerId, x, y, performance.now())) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch { controller.end(event.pointerId); return; }
    const snapshot = controller.snapshot(performance.now());
    setVisual(snapshot);
    if (frame.current === null) frame.current = requestAnimationFrame(tick);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const { x, y } = position(event);
    if (controller.move(event.pointerId, x, y)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    if (!controller.end(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    const snapshot = controller.snapshot(performance.now());
    publish(snapshot.axes);
    setVisual(snapshot);
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
    catch { /* Safari may have already released a cancelled pointer. */ }
    if (!controller.active) stopFrame();
  }

  if (!enabled) return null;
  const accelerating = visual.fingers.some(finger => finger.role === 'flight');
  const turning = visual.fingers.some(finger => finger.role === 'attitude');
  return <div ref={surface} className="touch-gesture-controls" role="group" aria-label={t('触屏飞行控制')}
    onPointerDown={press} onPointerMove={move} onPointerUp={release}
    onPointerCancel={release} onLostPointerCapture={release}>
    {visual.fingers.map(finger => {
      const dx = finger.x - finger.originX;
      const dy = finger.y - finger.originY;
      const scale = Math.min(1, TOUCH_GESTURE_RADIUS / Math.max(1, Math.hypot(dx, dy)));
      return <div key={finger.id} className={`touch-gesture-anchor touch-gesture-${finger.role}`}
        style={{ left: finger.originX, top: finger.originY }} aria-hidden="true">
        <span className="touch-gesture-origin" />
        <span className="touch-gesture-finger" style={{ transform: `translate(${dx * scale}px, ${dy * scale}px)` }}>
          {finger.role === 'flight' ? <Move size={18} /> : <RotateCw size={18} />}
        </span>
        <span className="touch-gesture-label">{t(finger.role === 'flight' ? '移动' : '高度与转向')}</span>
      </div>;
    })}
    <div className={`touch-gesture-hint ${accelerating ? 'touch-gesture-hint-active' : ''}`} aria-hidden="true">
      <Hand size={15} />
      <span>{t(turning ? '第二指：上下升降 · 左右转向' : '按住渐进加速 · 拖动飞行 · 松手减速')}</span>
      {accelerating ? <span className="touch-gesture-throttle" style={{ '--gesture-throttle': visual.throttle } as CSSProperties}>
        <i /><small>{Math.round(visual.throttle * 100)}%</small>
      </span> : <small>{t('双指升降 / 转向')}</small>}
    </div>
  </div>;
}
