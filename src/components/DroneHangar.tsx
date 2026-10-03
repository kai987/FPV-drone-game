import { useEffect, useId, useRef, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { DRONES, DRONE_CATALOG_NOTE, getDroneSpec, getFlightConfig } from '../game/drone-catalog';
import type { DroneId, DroneSpec } from '../game/drone-catalog';
import type { FlightMode, Status } from '../game/types';
import { useDroneThumbnails } from './useDroneThumbnails';
import { DroneModelPreview } from './DroneModelPreview';

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
    { label: '机架尺寸', value: drone => `${drone.wheelbaseMm} mm 轴距` },
    { label: '旋翼桨径', value: drone => `${drone.propellerInches} 英寸` },
    { label: '起飞重量', value: drone => `${drone.weightGrams} g` },
    { label: '电池', value: drone => drone.battery },
    { label: '电机', value: drone => drone.motors },
    { label: '镜头', value: drone => drone.lens },
    { label: '图传', value: drone => drone.videoLink },
    { label: '参考续航', value: drone => `约 ${drone.enduranceMinutes} 分钟` },
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
      <div><span className="section-index">AEROFLOW / HANGAR</span><h2 id={titleId}>选一架，迎着风。</h2><p id={descriptionId}>{DRONES.length} 款机型 · 游戏同款 3D 模型，可旋转查看细节。</p></div>
      <button ref={closeButton} className="icon-button" type="button" aria-label="关闭机库" onClick={onClose}><X size={21} /></button>
    </div>
    <div className="hangar-body">
      <div className="hangar-models" role="group" aria-label="查看机型">
        {DRONES.map(drone => <button type="button" key={drone.id} className={`hangar-model${selectedId === drone.id ? ' selected' : ''}`} aria-pressed={selectedId === drone.id} aria-label={`${drone.name}，${drone.category}${droneId === drone.id ? '，当前机型' : ''}`} onClick={() => setSelectedId(drone.id)}>
          <span className="hangar-model-image">{images[drone.id]
            ? <img src={images[drone.id]} alt={`${drone.name} 游戏同款三维模型`} width={420} height={280} draggable={false} />
            : <span className="hangar-image-placeholder">{loading ? '正在渲染模型…' : '3D 预览暂不可用'}</span>}
          </span><strong>{drone.name}</strong><span>{drone.category}</span>
          {droneId === drone.id ? <small><Check size={11} aria-hidden="true" /> 当前机型</small> : <small>{Math.round(getFlightConfig(drone.id, 'sport').speed * 3.6)} km/h · 运动</small>}
        </button>)}
      </div>
      <div className="hangar-inspector">
        <DroneModelPreview droneId={selectedId} />
        <div className="hangar-selection" aria-live="polite">
          <span className="hangar-model-color" style={{ backgroundColor: selected.color }} />
          <div><span className="hangar-preview-label">3D 模型预览</span><h3>{selected.name}<span>{selected.tagline}</span></h3>
            <p>{selected.description}</p><span className="hangar-finish"><i style={{ backgroundColor: selected.color }} />{FINISHES[selectedId]}</span>
            <p className="hangar-model-note">缩略图、旋转预览与飞行场中的无人机使用同一模型。</p>
          </div>
        </div>
      </div>
      {selected.reference ? <aside className="hangar-source" aria-label="真实原型资料">
        <div><span className="hangar-source-label">灵感来源 · {selected.reference.name}</span><a href={selected.reference.url} target="_blank" rel="noopener noreferrer">{selected.reference.source}<ExternalLink size={12} aria-hidden="true" /></a></div>
        <p><strong>{selected.reference.speedKmh.toLocaleString('zh-CN')} <small>km/h</small></strong><span>{selected.reference.speedLabel}</span></p>
        <p>{selected.reference.summary}本机为游戏改编，运动模式限速 {Math.round(getFlightConfig(selected.id, 'sport').speed * 3.6)} km/h；下方硬件为游戏设定。</p>
      </aside> : null}
      <div className="hangar-performance-heading"><h3><span className="hangar-comparison-title">{DRONES.length} 款参数对比</span><span className="hangar-details-title">机型详细参数</span></h3><div className="segment-control" role="group" aria-label="预览模拟性能的飞行模式"><button type="button" className={previewMode === 'assisted' ? 'active' : ''} aria-pressed={previewMode === 'assisted'} onClick={() => setPreviewMode('assisted')}>辅助</button><button type="button" className={previewMode === 'sport' ? 'active' : ''} aria-pressed={previewMode === 'sport'} onClick={() => setPreviewMode('sport')}>运动</button></div></div>
      <section className="hangar-selected-specs" aria-label={`${selected.name}详细参数`}>
        <h4>{selected.name} · 硬件参考</h4>
        <dl>{hardwareRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value(selected)}</dd></div>)}</dl>
        <h4>{previewMode === 'assisted' ? '辅助' : '运动'}模式 · 游戏模拟</h4>
        <dl>{performanceRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.values[selectedIndex]}</dd></div>)}</dl>
        <p className="hangar-reference-note">模式按钮仅预览性能，不改变当前飞行设置。</p>
      </section>
      <p className="hangar-table-hint">可左右滑动对比；模式按钮仅预览参数。</p>
      <div className="hangar-table-scroll" tabIndex={0} role="region" aria-label="无人机参数对比，可左右滚动">
        <table className="hangar-table" aria-label={`硬件参考与${previewMode === 'assisted' ? '辅助' : '运动'}模式模拟性能`}>
          <thead><tr><th scope="col">参数</th>{DRONES.map(drone => <th key={drone.id} scope="col" className={selectedId === drone.id ? 'selected-column' : ''}>{drone.name}{droneId === drone.id ? <small>当前机型</small> : null}</th>)}</tr></thead>
          <tbody><tr className="hangar-table-section"><th colSpan={DRONES.length + 1}>硬件参考设定</th></tr>{hardwareRows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{DRONES.map(drone => <td key={drone.id} className={selectedId === drone.id ? 'selected-column' : ''}>{row.value(drone)}</td>)}</tr>)}</tbody>
          <tbody><tr className="hangar-table-section"><th colSpan={DRONES.length + 1}>游戏模拟 · {previewMode === 'assisted' ? '辅助' : '运动'}模式</th></tr>{performanceRows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{DRONES.map((drone, index) => <td key={drone.id} className={selectedId === drone.id ? 'selected-column' : ''}>{row.values[index]}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="hangar-reference-note">{DRONE_CATALOG_NOTE}续航目前不模拟耗电；镜头、图传不改变实际画面配置。</p>
      <p className="hangar-reference-note">速度为直飞限速；加速和制动按指数响应，响应时间表示达到目标变化量约 63% 的时间。</p>
    </div>
    <div className="hangar-footer">
      <p>{canSwitch ? unchanged ? '当前已选用这款机型。' : '应用后从起点准备起飞。' : '飞行已暂停；切换机型需返回起点，会重置本轮进度、弹药与得分。'}</p>
      <div className="hangar-actions"><button className="primary-button hangar-apply" type="button" disabled={!available || !canSwitch || unchanged} onClick={() => onApply(selectedId, status === 'finished')}>{unchanged ? '当前机型' : status === 'finished' ? '返回起点并应用' : '选用这款机型'}</button>{!canSwitch && !unchanged ? <button className="hangar-reset-apply" type="button" disabled={!available} onClick={() => onApply(selectedId, true)}>返回起点并应用</button> : null}</div>
    </div>
  </dialog>;
}
