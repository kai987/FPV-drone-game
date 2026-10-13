import { useEffect, useRef } from 'react';
import { Bomb, Crosshair } from 'lucide-react';
import type { Status } from '../game/types';
import { useI18n } from '../i18n/context';
import './WeaponPanel.css';

interface WeaponPanelProps {
  kind: 'bomb' | 'machine-gun';
  capacity: number;
  firing: boolean;
  ammo: number;
  reloadRemaining: number;
  score: number;
  hits: number;
  status: Status;
  onDrop: () => void;
  onFireChange: (held: boolean) => void;
}

export default function WeaponPanel({ kind, capacity, firing, ammo, reloadRemaining, score, hits, status, onDrop, onFireChange }: WeaponPanelProps) {
  const { t } = useI18n();
  const gun = kind === 'machine-gun';
  const remaining = Math.max(0, Math.min(capacity, Math.trunc(ammo)));
  const reloading = reloadRemaining > 0;
  // Keep a held trigger through automatic reload, but never through a pause.
  const disabled = status !== 'flying' || (!gun && (remaining === 0 || reloading));
  const fireCallback = useRef(onFireChange);
  fireCallback.current = onFireChange;
  const triggerButton = useRef<HTMLButtonElement>(null);
  const heldPointer = useRef<number | null>(null);
  const heldKeys = useRef(new Set<string>());
  const sentHeld = useRef(false);
  const sendHeld = () => {
    const held = heldPointer.current !== null || heldKeys.current.size > 0;
    if (held !== sentHeld.current) {
      sentHeld.current = held;
      fireCallback.current(held);
    }
  };
  const release = () => {
    const pointer = heldPointer.current;
    heldPointer.current = null;
    heldKeys.current.clear();
    sendHeld();
    if (pointer !== null) {
      try { if (triggerButton.current?.hasPointerCapture(pointer)) triggerButton.current.releasePointerCapture(pointer); }
      catch { /* Safari can release a cancelled touch before this handler. */ }
    }
  };
  useEffect(() => {
    if (status !== 'flying' || kind !== 'machine-gun') release();
  }, [status, kind]);
  useEffect(() => {
    const stop = () => {
      release();
    };
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', visibility); stop(); };
  }, []);
  const WeaponIcon = gun ? Crosshair : Bomb;
  const slots = gun ? 10 : capacity;

  return (
    <section className={`weapon-panel${gun ? ' weapon-panel-gun' : ''}${reloading ? ' weapon-panel-reloading' : ''}${firing ? ' weapon-panel-firing' : ''}`} aria-label={t(gun ? '无人机机枪系统' : '无人机投弹系统')}>
      <div className="weapon-panel-heading">
        <WeaponIcon size={13} strokeWidth={1.7} aria-hidden="true" />
        <span>{t(gun ? '机枪系统' : '投弹系统')}</span>
        <small>{t(reloading ? '装填中' : firing ? '射击中' : status === 'flying' ? '就绪' : '待命')}</small>
      </div>
      <div className="weapon-panel-readout">
        <div className="weapon-panel-ammo" aria-label={gun ? t('剩余子弹 {count} 发，共 {capacity} 发', { count: remaining, capacity }) : t('剩余炸弹 {count} 枚，共 6 枚', { count: remaining })}>
          <div><strong>{String(remaining).padStart(2, '0')}</strong><span>/ {String(capacity).padStart(2, '0')}</span></div>
          <div className="weapon-panel-rounds" aria-hidden="true">
            {Array.from({ length: slots }, (_, index) => <i className={index < Math.ceil(remaining / capacity * slots) ? 'loaded' : ''} key={index} />)}
          </div>
        </div>
        <dl className="weapon-panel-stats">
          <div><dt><Crosshair size={10} strokeWidth={1.8} aria-hidden="true" />{t('命中')}</dt><dd>{hits}<span>/ 5</span></dd></div>
          <div><dt>{t('得分')}</dt><dd>{score}</dd></div>
        </dl>
      </div>
      <button
        ref={triggerButton}
        className="weapon-panel-drop"
        type="button"
        aria-label={t(gun ? '长按射击' : '投弹')}
        aria-pressed={gun ? firing : undefined}
        aria-keyshortcuts={gun ? 'F' : 'B'}
        title={t(gun ? '按住 F 或此按钮连续射击，松开停止；准星瞄准靶标' : '投弹（B）；按 V 切换俯视瞄准')}
        disabled={disabled}
        onClick={gun ? undefined : onDrop}
        onPointerDown={event => {
          if (!gun || disabled || heldPointer.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
          event.preventDefault();
          event.stopPropagation();
          try { event.currentTarget.setPointerCapture(event.pointerId); }
          catch { return; }
          heldPointer.current = event.pointerId;
          sendHeld();
        }}
        onPointerUp={event => {
          if (event.pointerId !== heldPointer.current) return;
          heldPointer.current = null;
          sendHeld();
          try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
          catch { /* Capture may already have been released. */ }
        }}
        onPointerCancel={event => { if (event.pointerId === heldPointer.current) { heldPointer.current = null; sendHeld(); } }}
        onLostPointerCapture={event => { if (event.pointerId === heldPointer.current) { heldPointer.current = null; sendHeld(); } }}
        onKeyDown={event => {
          if (!gun || disabled || (event.key !== ' ' && event.key !== 'Enter')) return;
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat) { heldKeys.current.add(event.key); sendHeld(); }
        }}
        onKeyUp={event => {
          if (!gun || !heldKeys.current.has(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          heldKeys.current.delete(event.key); sendHeld();
        }}
        onBlur={release}
        onContextMenu={event => { if (gun) event.preventDefault(); }}
      >
        <WeaponIcon size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{reloading ? t('装填 {seconds} s', { seconds: Math.max(0, reloadRemaining).toFixed(1) }) : t(gun ? '长按射击' : '投弹')}</span>
        <kbd aria-hidden="true">{gun ? 'F' : 'B'}</kbd>
      </button>
      <p className="weapon-panel-hint">{gun ? t('准星瞄准 · 松开停止射击') : <><span>V</span> {t('切换俯视瞄准')}</>}</p>
    </section>
  );
}
