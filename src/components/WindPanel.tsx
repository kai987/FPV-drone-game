import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, Settings2, Wind, X } from 'lucide-react';
import type { Telemetry } from '../game/types';
import { WIND_PRESETS } from '../game/wind';
import type { WindSettings } from '../game/wind';
import { useI18n } from '../i18n/context';
import './WindPanel.css';

const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function WindPanel({ wind, airSpeed, onOpen }: { wind: Telemetry['wind']; airSpeed: number; onOpen: () => void }) {
  const { t } = useI18n();
  const calm = wind.speed < 0.1;
  const bearing = Math.round(wind.fromDegrees) % 360;
  return <button className="wind-hud" type="button" aria-label={t(calm ? '风况设置，{direction}，{speed} 米每秒，{relative}' : '动态风况设置，实时来风方向 {degrees} 度，{direction}，{speed} 米每秒，{relative}', { direction: t(wind.directionLabel), speed: wind.speed.toFixed(1), relative: t(wind.relativeLabel), degrees: bearing })}
    title={t(calm ? '空速 {speed} km/h · 点击调整风况' : '实际风向随时间平滑偏转 · 空速 {speed} km/h · 点击调整基准风况', { speed: airSpeed.toFixed(0) })}
    onClick={event => { event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); onOpen(); }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
    <Wind size={17} aria-hidden="true" />
    <span className="wind-hud-readout"><strong>{calm ? t('无风') : t('{direction}风', { direction: t(wind.directionLabel) })} <b>{wind.speed.toFixed(1)}</b><small>m/s</small></strong>
      <span>{!calm && <><span className="wind-hud-bearing">{bearing}°</span><span>{t('动态')}</span><i /></>}{t(wind.relativeLabel)}{calm && <><i />{t('调整风况')}</>}</span></span>
    <Settings2 size={13} aria-hidden="true" />
  </button>;
}

export function WindSettingsDialog({ settings, activeFlight, onApply, onClose }: {
  settings: WindSettings; activeFlight: boolean; onApply: (value: WindSettings) => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
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
    <div className="wind-dialog-heading"><div><span className="section-index">{t('VALLEY / WIND')}</span><h2 id={titleId}>{t('感受风的方向。')}</h2></div>
      <button ref={close} className="icon-button" type="button" aria-label={t('关闭风况设置')} onClick={onClose}><X size={20} /></button></div>
    <p className="wind-intro">{t('迎风减速，顺风加速，侧风让航迹偏移。用反向操纵修正；辅助模式会减轻风偏，运动模式受风更明显。地速相对地面，空速相对空气，机库速度为无风参考。')}</p>
    <fieldset><legend>{t('风力')} <small>{t('基准风速 · 阵风会平滑变化')}</small></legend><div className="wind-strengths">
      {(Object.entries(WIND_PRESETS) as [WindSettings['strength'], { label: string; baseSpeed: number }][]).map(([strength, preset]) =>
        <button key={strength} type="button" aria-pressed={draft.strength === strength} onClick={() => setDraft(current => ({ ...current, strength }))}>
          <strong>{t(preset.label)}</strong><span>{preset.baseSpeed} m/s</span>
        </button>)}
    </div></fieldset>
    <fieldset disabled={calm}><legend>{t('基准来风方向')} <small>{t('实际风向会平滑偏转')}</small></legend><div className="wind-direction-control">
      <div className={`wind-compass${calm ? ' is-calm' : ''}`} aria-hidden="true"><span>N</span><span>E</span><span>S</span><span>W</span>
        <ArrowDown style={{ transform: `rotate(${draft.direction}deg)` }} size={58} strokeWidth={1.2} /></div>
      <div className="wind-directions">{DIRECTIONS.map((name, index) => <button key={name} type="button" aria-label={t('{direction}基准风，从{direction}方吹来', { direction: t(name) })}
        aria-pressed={draft.direction === index * 45} onClick={() => setDraft(current => ({ ...current, direction: index * 45 }))}>{locale === 'en' ? COMPASS_POINTS[index] : t(name)}</button>)}</div>
    </div></fieldset>
    <p className="wind-direction-note">{t('基准风向表示来向，例如北风从北向南吹。起飞后实际来向会平滑偏转；仪表度数与地图箭头实时更新，暂停时冻结。')}</p>
    <p className="wind-context">{t(activeFlight ? '飞行已暂停。应用后保留位置与进度；手动修改基准风况的这一轮不计入个人最佳，自动风向变化仍可记录。关闭后可继续飞行。' : '风速随时间、位置和高度轻微变化。个人最佳按机型、飞行模式及基准风况分别记录。')}</p>
    <button className="primary-button wind-apply" type="button" onClick={() => onApply(draft)}>{t('应用风况')} <Wind size={17} /></button>
  </dialog>;
}
