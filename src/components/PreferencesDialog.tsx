import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, Check, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { QualityPreset } from '../game/graphics-quality';
import { isQualityPreset } from '../game/graphics-quality';
import { useI18n } from '../i18n/context';
import BuildInfo from './BuildInfo';
import type { TouchSettings } from './touch-settings';
import './PreferencesDialog.css';

export interface AdjustablePreferences {
  qualityPreset: QualityPreset;
  touch: TouchSettings;
  sound: boolean;
}

interface PreferencesDialogProps {
  value: AdjustablePreferences;
  storageAvailable: boolean;
  onApply(value: AdjustablePreferences): void;
  onReset(): void;
  onClose(): void;
  onOpenGuide(): void;
  buildInfo?: ReactNode;
}

const PRESETS: readonly [QualityPreset, string][] = [['auto', '自动'], ['low', '低'], ['medium', '中'], ['high', '高']];

export default function PreferencesDialog({ value, storageAvailable, onApply, onReset, onClose, onOpenGuide, buildInfo = <BuildInfo /> }: PreferencesDialogProps) {
  const { t, languageTag } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [draft, setDraft] = useState<AdjustablePreferences>(() => ({ ...value, touch: { ...value.touch } }));
  const qualityChanged = draft.qualityPreset !== value.qualityPreset;
  const updateTouch = (change: Partial<TouchSettings>) => setDraft(current => ({ ...current, touch: { ...current.touch, ...change } }));
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal(); closeButton.current?.focus({ preventScroll: true });
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="preferences-dialog" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    onKeyUp={event => event.stopPropagation()} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="preferences-heading"><div><span className="section-index">AEROFLOW / PREFERENCES</span><h2 id={`${id}-title`}>{t('飞行偏好')}</h2></div>
      <button ref={closeButton} className="icon-button" type="button" aria-label={t('关闭设置')} onClick={onClose}><X size={20} /></button></div>
    <p className="preferences-intro">{t('保留常用设置，让下一次起飞更顺手。飞行已暂停，关闭后可手动继续。')}</p>
    <section className="preferences-section" aria-labelledby={`${id}-graphics`}>
      <h3 id={`${id}-graphics`}>{t('画面与声音')}</h3>
      <label className="preferences-field" htmlFor={`${id}-quality`}><span>{t('画质')}</span><select id={`${id}-quality`} value={draft.qualityPreset}
        onChange={event => { if (isQualityPreset(event.target.value)) setDraft(current => ({ ...current, qualityPreset: event.target.value as QualityPreset })); }}>
        {PRESETS.map(([preset, label]) => <option key={preset} value={preset}>{t(label)}</option>)}
      </select></label>
      <p className="preferences-help">{t('自动会根据设备和帧率调整；低画质优先流畅，高画质保留更多细节。')}</p>
      <label className="preferences-check"><input type="checkbox" checked={draft.sound} onChange={event => setDraft(current => ({ ...current, sound: event.target.checked }))} /><span>{t('游戏声音')}</span></label>
      <p className="preferences-help">{t('声音偏好会保存；重新打开网页后，声音从下一次点击或按键开始。')}</p>
    </section>
    <section className="preferences-section" aria-labelledby={`${id}-touch`}>
      <h3 id={`${id}-touch`}>{t('触屏飞行手势')}</h3>
      <div className="preferences-slider"><label htmlFor={`${id}-sensitivity`}>{t('操控灵敏度')}</label><output htmlFor={`${id}-sensitivity`}>{Math.round(draft.touch.sensitivity * 100)}%</output>
        <input id={`${id}-sensitivity`} type="range" min="0.5" max="2" step="0.05" value={draft.touch.sensitivity}
          onChange={event => updateTouch({ sensitivity: Number(event.target.value) })} /></div>
      <div className="preferences-slider"><label htmlFor={`${id}-acceleration`}>{t('按住加速时间')}</label><output htmlFor={`${id}-acceleration`}>{t('{seconds} 秒', { seconds: (draft.touch.accelerationMs / 1_000).toLocaleString(languageTag, { maximumFractionDigits: 2 }) })}</output>
        <input id={`${id}-acceleration`} type="range" min="500" max="4000" step="250" value={draft.touch.accelerationMs}
          onChange={event => updateTouch({ accelerationMs: Number(event.target.value) })} /></div>
      <label className="preferences-check"><input type="checkbox" checked={draft.touch.invertVertical} onChange={event => updateTouch({ invertVertical: event.target.checked })} /><span>{t('反转上下拖动')}</span></label>
      <p className="preferences-help">{t('上下反转仅影响触屏飞行的前后与升降手势，不改变键盘、鼠标或机枪瞄准。')}</p>
    </section>
    <p className={`preferences-quality-note${qualityChanged ? ' is-changing' : ''}`} role={qualityChanged ? 'status' : undefined}>
      <SlidersHorizontal size={16} aria-hidden="true" />{t('更改画质会重新准备全部地图，并返回当前地图起点；位置、弹药和本轮进度会重置。')}</p>
    <p className="preferences-storage-note">{t(storageAvailable ? '机型、地图、模式、风况、昼夜、视角及这些偏好保存在本浏览器；位置、弹药和飞行进度不保存。' : '浏览器无法保存设置；当前页面内仍可正常调整，重新打开后这些更改可能不会保留。')}</p>
    <div className="preferences-actions"><button className="primary-button" type="button" onClick={() => onApply(draft)}><Check size={17} />{t('应用设置')}</button>
      <button className="text-button" type="button" onClick={onOpenGuide}><BookOpen size={16} />{t('查看操作指南')}</button></div>
    <div className="preferences-reset"><p>{t('重置全部偏好会返回山谷起点并重新准备地图，个人最佳与语言选择会保留。')}</p>
      <button className="text-button" type="button" onClick={onReset}><RotateCcw size={15} />{t('重置全部偏好')}</button></div>
    {buildInfo ? <div className="preferences-build-info">{buildInfo}</div> : null}
  </dialog>;
}
