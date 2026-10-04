import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, RotateCcw, RotateCw } from 'lucide-react';
import { useI18n } from '../i18n/context';

type Axis = 'forward' | 'strafe' | 'climb' | 'yaw';
interface TouchControlsProps {
  onAxis: (axis: Axis, value: number) => void;
}

const AXES: Axis[] = ['forward', 'strafe', 'climb', 'yaw'];
const CONTROLS = [
  { axis: 'forward', value: 1, label: '前进', className: 'touch-up', Icon: ArrowUp },
  { axis: 'forward', value: -1, label: '后退', className: 'touch-down', Icon: ArrowDown },
  { axis: 'strafe', value: -1, label: '向左平移', className: 'touch-left', Icon: ArrowLeft },
  { axis: 'strafe', value: 1, label: '向右平移', className: 'touch-right', Icon: ArrowRight },
  { axis: 'climb', value: 1, label: '上升', className: 'touch-up', Icon: ChevronUp },
  { axis: 'climb', value: -1, label: '下降', className: 'touch-down', Icon: ChevronDown },
  { axis: 'yaw', value: 1, label: '左转', className: 'touch-left', Icon: RotateCcw },
  { axis: 'yaw', value: -1, label: '右转', className: 'touch-right', Icon: RotateCw },
] as const;

export default function TouchControls({ onAxis }: TouchControlsProps) {
  const { t } = useI18n();
  const pressed = useRef(new Map<number, { axis: Axis; value: number }>());
  const published = useRef<Record<Axis, number>>({ forward: 0, strafe: 0, climb: 0, yaw: 0 });
  const onAxisRef = useRef(onAxis);

  useEffect(() => { onAxisRef.current = onAxis; }, [onAxis]);

  function publish() {
    for (const axis of AXES) {
      let value = 0;
      for (const input of pressed.current.values()) {
        if (input.axis === axis) value += input.value;
      }
      value = Math.max(-1, Math.min(1, value));
      if (published.current[axis] !== value) {
        published.current[axis] = value;
        onAxisRef.current(axis, value);
      }
    }
  }

  function release(pointerId: number) {
    if (pressed.current.delete(pointerId)) publish();
  }

  function press(event: PointerEvent<HTMLButtonElement>, axis: Axis, value: number) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressed.current.set(event.pointerId, { axis, value });
    publish();
  }

  useEffect(() => {
    const reset = () => {
      pressed.current.clear();
      for (const axis of AXES) {
        if (published.current[axis] !== 0) {
          published.current[axis] = 0;
          onAxisRef.current(axis, 0);
        }
      }
    };
    const handleVisibility = () => { if (document.hidden) reset(); };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', handleVisibility);
      reset();
    };
  }, []);

  function renderControl(index: number) {
    const { axis, value, label, className, Icon } = CONTROLS[index];
    const keyboardId = -index - 1;
    return (
      <button
        key={label}
        type="button"
        className={`touch-direction ${className}`}
        aria-label={t(label)}
        title={t(label)}
        onPointerDown={(event) => press(event, axis, value)}
        onPointerUp={(event) => release(event.pointerId)}
        onPointerCancel={(event) => release(event.pointerId)}
        onLostPointerCapture={(event) => release(event.pointerId)}
        onKeyDown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
          pressed.current.set(keyboardId, { axis, value });
          publish();
        }}
        onKeyUp={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return;
          event.preventDefault();
          event.stopPropagation();
          release(keyboardId);
        }}
        onBlur={() => release(keyboardId)}
      >
        <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="touch-controls" aria-label={t('触屏飞行控制')}>
      <div className="touch-pad" role="group" aria-label={t('前进与平移')}>
        {[0, 1, 2, 3].map(renderControl)}
        <span className="touch-center" aria-hidden="true">{t('移动')}</span>
      </div>
      <div className="touch-pad touch-altitude" role="group" aria-label={t('高度与转向')}>
        {[4, 5, 6, 7].map(renderControl)}
        <span className="touch-center" aria-hidden="true">{t('姿态')}</span>
      </div>
    </div>
  );
}
