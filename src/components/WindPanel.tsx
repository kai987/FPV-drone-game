import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, Settings2, Wind, X } from 'lucide-react';
import type { Telemetry } from '../game/types';
import { WIND_PRESETS } from '../game/wind';
import type { WindSettings } from '../game/wind';
import './WindPanel.css';

const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

export default function WindPanel({ wind, airSpeed, onOpen }: { wind: Telemetry['wind']; airSpeed: number; onOpen: () => void }) {
  return <button className="wind-hud" type="button" aria-label={`风况设置，${wind.directionLabel}，${wind.speed.toFixed(1)} 米每秒，${wind.relativeLabel}`}
    title={`风向按来向标注 · 空速 ${airSpeed.toFixed(0)} km/h · 点击调整风况`}
    onClick={event => { event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); onOpen(); }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
    <Wind size={17} aria-hidden="true" />
    <span className="wind-hud-readout"><strong>{wind.speed < 0.1 ? '无风' : `${wind.directionLabel}风`} <b>{wind.speed.toFixed(1)}</b><small>m/s</small></strong>
      <span>{wind.relativeLabel}<i />调整风况</span></span>
    <Settings2 size={13} aria-hidden="true" />
  </button>;
}

export function WindSettingsDialog({ settings, activeFlight, onApply, onClose }: {
  settings: WindSettings; activeFlight: boolean; onApply: (value: WindSettings) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<WindSettings>({ ...settings });
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal(); close.current?.focus({ preventScroll: true });
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  const calm = draft.strength === 'calm';
  return <dialog ref={dialog} className="wind-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    onKeyUp={event => event.stopPropagation()} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="wind-dialog-heading"><div><span className="section-index">VALLEY / WIND</span><h2 id={titleId}>感受风的方向。</h2></div>
      <button ref={close} className="icon-button" type="button" aria-label="关闭风况设置" onClick={onClose}><X size={20} /></button></div>
    <p className="wind-intro">迎风减速，顺风加速，侧风让航迹偏移。用反向操纵修正；辅助模式会减轻风偏，运动模式受风更明显。地速相对地面，空速相对空气，机库速度为无风参考。</p>
    <fieldset><legend>风力 <small>基准风速 · 阵风会平滑变化</small></legend><div className="wind-strengths">
      {(Object.entries(WIND_PRESETS) as [WindSettings['strength'], { label: string; baseSpeed: number }][]).map(([strength, preset]) =>
        <button key={strength} type="button" aria-pressed={draft.strength === strength} onClick={() => setDraft(current => ({ ...current, strength }))}>
          <strong>{preset.label}</strong><span>{preset.baseSpeed} m/s</span>
        </button>)}
    </div></fieldset>
    <fieldset disabled={calm}><legend>来风方向 <small>北风表示从北向南吹</small></legend><div className="wind-direction-control">
      <div className={`wind-compass${calm ? ' is-calm' : ''}`} aria-hidden="true"><span>N</span><span>E</span><span>S</span><span>W</span>
        <ArrowDown style={{ transform: `rotate(${draft.direction}deg)` }} size={58} strokeWidth={1.2} /></div>
      <div className="wind-directions">{DIRECTIONS.map((name, index) => <button key={name} type="button" aria-label={`${name}风，从${name}方吹来`}
        aria-pressed={draft.direction === index * 45} onClick={() => setDraft(current => ({ ...current, direction: index * 45 }))}>{name}</button>)}</div>
    </div></fieldset>
    <p className="wind-context">{activeFlight ? '飞行已暂停。应用后保留位置与进度；本轮若改变风况，将不计入个人最佳。关闭后可继续飞行。' : '起飞后风会随时间、位置和高度轻微变化。个人最佳按机型、飞行模式及风况分别记录。'}</p>
    <button className="primary-button wind-apply" type="button" onClick={() => onApply(draft)}>应用风况 <Wind size={17} /></button>
  </dialog>;
}
