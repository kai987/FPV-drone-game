import { useEffect, useId, useRef, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { DRONES, DRONE_CATALOG_NOTE, getDroneSpec, getFlightConfig } from '../game/drone-catalog';
import type { DroneId, DroneSpec } from '../game/drone-catalog';
import type { FlightMode, Status } from '../game/types';
import { useDroneThumbnails } from './useDroneThumbnails';
import { DroneModelPreview } from './DroneModelPreview';
import { useI18n } from '../i18n/context';

interface DroneHangarProps {
  droneId: DroneId;
  flightMode: FlightMode;
  status: Status;
  available: boolean;
  onApply: (id: DroneId, returnToStart: boolean) => void;
  onClose: () => void;
}

const FINISHES: Record<DroneId, string> = {
  cinewhoop: '焰橙 · 碳黑', freestyle: '萤绿 · 碳黑', racer: '竞速红 · 碳黑',
  explorer: '远空蓝 · 碳黑', vector: '冰川青 · 石墨', falcon: '琥珀金 · 石墨',
};

export default function DroneHangar({ droneId, flightMode, status, available, onApply, onClose }: DroneHangarProps) {
  const { t, languageTag } = useI18n();
  const { images, loading } = useDroneThumbnails();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [selectedId, setSelectedId] = useState(droneId);
  const [previewMode, setPreviewMode] = useState(flightMode);
  const selected = getDroneSpec(selectedId);
  const selectedIndex = DRONES.findIndex(drone => drone.id === selectedId);
  const canSwitch = status === 'ready' || status === 'finished';
  const unchanged = selectedId === droneId;
  const configs = DRONES.map(drone => getFlightConfig(drone.id, previewMode));
  const hardwareRows: { label: string; value: (drone: DroneSpec) => string }[] = [
    { label: '机架尺寸', value: drone => t('{value} mm 轴距', { value: drone.wheelbaseMm }) },
    { label: '旋翼桨径', value: drone => t('{value} 英寸', { value: drone.propellerInches }) },
    { label: '起飞重量', value: drone => `${drone.weightGrams} g` },
    { label: '电池', value: drone => drone.battery },
    { label: '电机', value: drone => drone.motors },
    { label: '镜头', value: drone => t(drone.lens) },
    { label: '图传', value: drone => t(drone.videoLink) },
    { label: '参考续航', value: drone => t('约 {value} 分钟', { value: drone.enduranceMinutes }) },
  ];
  const performanceRows = [
    { label: '最高速度', values: configs.map(config => `${(config.speed * 3.6).toFixed(1)} km/h`) },
    { label: '垂直速度', values: configs.map(config => `${config.climbSpeed.toFixed(1)} m/s`) },
    { label: '起步加速度', values: configs.map(config => `${config.initialAcceleration.toFixed(1)} m/s²`) },
    { label: '响应时间', values: configs.map(config => `${config.responseTime.toFixed(2)} s`) },
    { label: '转向速度', values: configs.map(config => `${Math.round(config.yawSpeed * 180 / Math.PI)} °/s`) },
    { label: '制动响应', values: configs.map(config => `${(1 / config.brake).toFixed(2)} s`) },
  ];

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={dialog} className="drone-hangar" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    onKeyUp={event => event.stopPropagation()}
    onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="hangar-heading">
      <div><span className="section-index">{t('AEROFLOW / HANGAR')}</span><h2 id={titleId}>{t('选一架，迎着风。')}</h2><p id={descriptionId}>{t('{count} 款机型 · 游戏同款 3D 模型，可旋转查看细节。', { count: DRONES.length })}</p></div>
      <button ref={closeButton} className="icon-button" type="button" aria-label={t('关闭机库')} onClick={onClose}><X size={21} /></button>
    </div>
    <div className="hangar-body">
      <div className="hangar-models" role="group" aria-label={t('查看机型')}>
        {DRONES.map(drone => <button type="button" key={drone.id} className={`hangar-model${selectedId === drone.id ? ' selected' : ''}`} aria-pressed={selectedId === drone.id} aria-label={t(droneId === drone.id ? '{name}，{category}，当前机型' : '{name}，{category}', { name: t(drone.name), category: t(drone.category) })} onClick={() => setSelectedId(drone.id)}>
          <span className="hangar-model-image">{images[drone.id]
            ? <img src={images[drone.id]} alt={t('{name} 游戏同款三维模型', { name: t(drone.name) })} width={420} height={280} draggable={false} />
            : <span className="hangar-image-placeholder">{t(loading ? '正在渲染模型…' : '3D 预览暂不可用')}</span>}
          </span><strong>{t(drone.name)}</strong><span>{t(drone.category)}</span>
          {droneId === drone.id ? <small><Check size={11} aria-hidden="true" /> {t('当前机型')}</small> : <small>{t('{speed} km/h · 运动', { speed: Math.round(getFlightConfig(drone.id, 'sport').speed * 3.6) })}</small>}
        </button>)}
      </div>
      <div className="hangar-inspector">
        <DroneModelPreview droneId={selectedId} />
        <div className="hangar-selection" aria-live="polite">
          <span className="hangar-model-color" style={{ backgroundColor: selected.color }} />
          <div><span className="hangar-preview-label">{t('3D 模型预览')}</span><h3>{t(selected.name)}<span>{t(selected.tagline)}</span></h3>
            <p>{t(selected.description)}</p><span className="hangar-finish"><i style={{ backgroundColor: selected.color }} />{t(FINISHES[selectedId])}</span>
            <p className="hangar-model-note">{t('缩略图、旋转预览与飞行场中的无人机使用同一模型。')}</p>
          </div>
        </div>
      </div>
      {selected.reference ? <aside className="hangar-source" aria-label={t('真实原型资料')}>
        <div><span className="hangar-source-label">{t('灵感来源 · {name}', { name: t(selected.reference.name) })}</span><a href={selected.reference.url} target="_blank" rel="noopener noreferrer">{t(selected.reference.source)}<ExternalLink size={12} aria-hidden="true" /></a></div>
        <p><strong>{selected.reference.speedKmh.toLocaleString(languageTag)} <small>km/h</small></strong><span>{t(selected.reference.speedLabel)}</span></p>
        <p>{t(selected.reference.summary)} {t('本机为游戏改编，运动模式限速 {speed} km/h；下方硬件为游戏设定。', { speed: Math.round(getFlightConfig(selected.id, 'sport').speed * 3.6) })}</p>
      </aside> : null}
      <div className="hangar-performance-heading"><h3><span className="hangar-comparison-title">{t('{count} 款参数对比', { count: DRONES.length })}</span><span className="hangar-details-title">{t('机型详细参数')}</span></h3><div className="segment-control" role="group" aria-label={t('预览模拟性能的飞行模式')}><button type="button" className={previewMode === 'assisted' ? 'active' : ''} aria-pressed={previewMode === 'assisted'} onClick={() => setPreviewMode('assisted')}>{t('辅助')}</button><button type="button" className={previewMode === 'sport' ? 'active' : ''} aria-pressed={previewMode === 'sport'} onClick={() => setPreviewMode('sport')}>{t('运动')}</button></div></div>
      <section className="hangar-selected-specs" aria-label={t('{name}详细参数', { name: t(selected.name) })}>
        <h4>{t('{name} · 硬件参考', { name: t(selected.name) })}</h4>
        <dl>{hardwareRows.map(row => <div key={row.label}><dt>{t(row.label)}</dt><dd>{row.value(selected)}</dd></div>)}</dl>
        <h4>{t('{mode}模式 · 游戏模拟', { mode: t(previewMode === 'assisted' ? '辅助' : '运动') })}</h4>
        <dl>{performanceRows.map(row => <div key={row.label}><dt>{t(row.label)}</dt><dd>{row.values[selectedIndex]}</dd></div>)}</dl>
        <p className="hangar-reference-note">{t('模式按钮仅预览性能，不改变当前飞行设置。')}</p>
      </section>
      <p className="hangar-table-hint">{t('可左右滑动对比；模式按钮仅预览参数。')}</p>
      <div className="hangar-table-scroll" tabIndex={0} role="region" aria-label={t('无人机参数对比，可左右滚动')}>
        <table className="hangar-table" aria-label={t('硬件参考与{mode}模式模拟性能', { mode: t(previewMode === 'assisted' ? '辅助' : '运动') })}>
          <thead><tr><th scope="col">{t('参数')}</th>{DRONES.map(drone => <th key={drone.id} scope="col" className={selectedId === drone.id ? 'selected-column' : ''}>{t(drone.name)}{droneId === drone.id ? <small>{t('当前机型')}</small> : null}</th>)}</tr></thead>
          <tbody><tr className="hangar-table-section"><th colSpan={DRONES.length + 1}>{t('硬件参考设定')}</th></tr>{hardwareRows.map(row => <tr key={row.label}><th scope="row">{t(row.label)}</th>{DRONES.map(drone => <td key={drone.id} className={selectedId === drone.id ? 'selected-column' : ''}>{row.value(drone)}</td>)}</tr>)}</tbody>
          <tbody><tr className="hangar-table-section"><th colSpan={DRONES.length + 1}>{t('游戏模拟 · {mode}模式', { mode: t(previewMode === 'assisted' ? '辅助' : '运动') })}</th></tr>{performanceRows.map(row => <tr key={row.label}><th scope="row">{t(row.label)}</th>{DRONES.map((drone, index) => <td key={drone.id} className={selectedId === drone.id ? 'selected-column' : ''}>{row.values[index]}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="hangar-reference-note">{t(DRONE_CATALOG_NOTE)} {t('续航目前不模拟耗电；镜头、图传不改变实际画面配置。')}</p>
      <p className="hangar-reference-note">{t('速度为无风直飞参考；迎风、顺风与侧风会改变实际地速和航迹。加速和制动按指数响应，响应时间表示达到目标变化量约 63% 的时间。')}</p>
    </div>
    <div className="hangar-footer">
      <p>{t(canSwitch ? unchanged ? '当前已选用这款机型。' : '应用后从起点准备起飞。' : '飞行已暂停；切换机型需返回起点，会重置本轮进度、弹药与得分。')}</p>
      <div className="hangar-actions"><button className="primary-button hangar-apply" type="button" disabled={!available || !canSwitch || unchanged} onClick={() => onApply(selectedId, status === 'finished')}>{t(unchanged ? '当前机型' : status === 'finished' ? '返回起点并应用' : '选用这款机型')}</button>{!canSwitch && !unchanged ? <button className="hangar-reset-apply" type="button" disabled={!available} onClick={() => onApply(selectedId, true)}>{t('返回起点并应用')}</button> : null}</div>
    </div>
  </dialog>;
}
