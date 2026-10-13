import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Crosshair } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { isTouchPointer, useTouchInput } from './useTouchInput';
import './AimControls.css';

export default function AimControls({ onAim }: { onAim: (dx: number, dy: number) => void }) {
  const { t } = useI18n();
  const surface = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const enabled = useTouchInput();
  const callback = useRef(onAim);
  useLayoutEffect(() => { callback.current = onAim; }, [onAim]);

  function release(updateVisual = true) {
    const active = pointer.current;
    pointer.current = null;
    if (updateVisual) setDragging(false);
    if (active) {
      try { if (surface.current?.hasPointerCapture(active.id)) surface.current.releasePointerCapture(active.id); }
      catch { /* A cancelled touch may already have lost capture. */ }
    }
  }

  useEffect(() => {
    const clear = () => release();
    const visibility = () => { if (document.hidden) release(); };
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', clear);
      document.removeEventListener('visibilitychange', visibility);
      release(false);
    };
  }, []);

  useLayoutEffect(() => { if (!enabled) release(); }, [enabled]);

  function end(event: PointerEvent<HTMLDivElement>) {
    if (!isTouchPointer(event) || event.pointerId !== pointer.current?.id) return;
    event.preventDefault(); event.stopPropagation();
    release();
  }

  if (!enabled) return null;
  return <div ref={surface} className={`touch-aim-controls${dragging ? ' aiming' : ''}`} role="group" aria-label={t('触屏瞄准区，拖动调整准星')}
    onPointerDown={event => {
      if (!enabled || !isTouchPointer(event) || pointer.current) return;
      event.preventDefault(); event.stopPropagation();
      try { event.currentTarget.setPointerCapture(event.pointerId); }
      catch { return; }
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      setDragging(true);
    }}
    onPointerMove={event => {
      const active = pointer.current;
      if (!isTouchPointer(event) || !active || event.pointerId !== active.id) return;
      event.preventDefault(); event.stopPropagation();
      callback.current(event.clientX - active.x, event.clientY - active.y);
      active.x = event.clientX; active.y = event.clientY;
    }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onContextMenu={event => event.preventDefault()}>
    <span className="touch-aim-hint" aria-hidden="true"><Crosshair size={14} />{t('滑动瞄准')}</span>
  </div>;
}
