import { useEffect, useId, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { DRONES, DRONE_CATALOG_NOTE, getDroneSpec, getFlightConfig } from '../game/drone-catalog';
import type { DroneId, DroneSpec } from '../game/drone-catalog';
import type { FlightMode, Status } from '../game/types';

interface DroneHangarProps {
  droneId: DroneId;
  flightMode: FlightMode;
  status: Status;
  available: boolean;
  onApply: (id: DroneId, returnToStart: boolean) => void;
  onClose: () => void;
}

function DroneOutline({ drone }: { drone: DroneSpec }) {
  const ducted = drone.frame === 'ducted';
  const longRange = drone.frame === 'long-range';
  const motorX = ducted ? 25 : longRange ? 39 : drone.frame === 'stretch-x' ? 29 : 35;
  const motorY = ducted ? 26 : drone.frame === 'stretch-x' ? 40 : longRange ? 38 : 33;
  const radius = ducted ? 21 : longRange ? 22 : 17;
  return <svg className="hangar-drone-outline" viewBox="-72 -72 144 144" role="img" aria-label={`${drone.name}，${drone.category}机架轮廓`}>
    <g transform="rotate(-12)">
      <path d={`M ${-motorX} ${-motorY} L ${motorX} ${motorY} M ${motorX} ${-motorY} L ${-motorX} ${motorY}`} stroke="#71806b" strokeWidth={ducted ? 7 : 9} strokeLinecap="round" />
      <path d={`M ${-motorX} ${-motorY} L ${motorX} ${motorY} M ${motorX} ${-motorY} L ${-motorX} ${motorY}`} stroke="#b2bea8" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      {[-1, 1].flatMap(x => [-1, 1].map(y => <g key={`${x}-${y}`} transform={`translate(${x * motorX} ${y * motorY})`}>
        <circle r={radius} fill={drone.color} fillOpacity={ducted ? 0.12 : 0.07} stroke={drone.color} strokeWidth={ducted ? 4 : 0.9} strokeOpacity={ducted ? 0.8 : 0.45} />
        {ducted ? <circle r={radius - 5} fill="none" stroke={drone.color} strokeOpacity="0.24" /> : null}
        <path d={`M ${-radius + 5} -2 Q -2 -7 0 -2 Q 3 -6 ${radius - 5} 2 Q 2 7 0 2 Q -4 6 ${-radius + 5} -2 Z`} fill={drone.color} fillOpacity="0.58" transform={`rotate(${x * y * 28})`} />
        <circle r="4" fill="#54624e" stroke="#d8dfcf" strokeWidth="1" />
      </g>))}
      <rect x={longRange ? -13 : -10} y={ducted ? -21 : -27} width={longRange ? 26 : 20} height={ducted ? 43 : 54} rx="6" fill="#42513d" stroke="#a3af96" strokeWidth="1.2" />
      <rect x="-7" y={ducted ? -13 : -20} width="14" height={ducted ? 25 : 36} rx="3" fill={drone.color} fillOpacity="0.85" />
      <path d={`M -12 -6 L 12 -6 M -12 6 L 12 6`} stroke="#33412f" strokeWidth="4" />
      <rect x="-7" y={ducted ? -28 : -33} width="14" height="10" rx="3" fill="#253329" stroke="#a6b19d" />
      <circle cy={ducted ? -25 : -30} r="3" fill="#c4d9da" />
      {longRange ? <path d="M 7 26 L 13 56 M 7 54 L 19 58" stroke={drone.color} strokeWidth="3" strokeLinecap="round" /> : <path d="M 0 26 L 0 38" stroke={drone.color} strokeWidth="2" />}
    </g>
  </svg>;
}

export default function DroneHangar({ droneId, flightMode, status, available, onApply, onClose }: DroneHangarProps) {
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
      <div><span className="section-index">AEROFLOW / HANGAR</span><h2 id={titleId}>选一架，迎着风。</h2><p id={descriptionId}>四种机架，四种飞行手感。参数随时可查。</p></div>
      <button ref={closeButton} className="icon-button" type="button" aria-label="关闭机库" onClick={onClose}><X size={21} /></button>
    </div>
    <div className="hangar-body">
      <div className="hangar-models" role="group" aria-label="查看机型">
        {DRONES.map(drone => <button type="button" key={drone.id} className={`hangar-model${selectedId === drone.id ? ' selected' : ''}`} aria-pressed={selectedId === drone.id} onClick={() => setSelectedId(drone.id)}>
          <DroneOutline drone={drone} /><strong>{drone.name}</strong><span>{drone.category}</span>
          {droneId === drone.id ? <small><Check size={11} aria-hidden="true" /> 当前机型</small> : <small>{drone.propellerInches}″ · {drone.weightGrams} g</small>}
        </button>)}
      </div>
      <div className="hangar-selection" aria-live="polite"><span className="hangar-model-color" style={{ backgroundColor: selected.color }} /><div><h3>{selected.name}<span>{selected.tagline}</span></h3><p>{selected.description}</p></div></div>
      <div className="hangar-performance-heading"><h3><span className="hangar-comparison-title">四款参数对比</span><span className="hangar-details-title">机型详细参数</span></h3><div className="segment-control" role="group" aria-label="预览模拟性能的飞行模式"><button type="button" className={previewMode === 'assisted' ? 'active' : ''} aria-pressed={previewMode === 'assisted'} onClick={() => setPreviewMode('assisted')}>辅助</button><button type="button" className={previewMode === 'sport' ? 'active' : ''} aria-pressed={previewMode === 'sport'} onClick={() => setPreviewMode('sport')}>运动</button></div></div>
      <section className="hangar-selected-specs" aria-label={`${selected.name}详细参数`}>
        <h4>{selected.name} · 硬件参考</h4>
        <dl>{hardwareRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value(selected)}</dd></div>)}</dl>
        <h4>{previewMode === 'assisted' ? '辅助' : '运动'}模式 · 游戏模拟</h4>
        <dl>{performanceRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.values[selectedIndex]}</dd></div>)}</dl>
        <p className="hangar-reference-note">模式按钮仅预览性能，不改变当前飞行设置。</p>
      </section>
      <p className="hangar-table-hint">可左右滑动对比；模式按钮仅预览参数。</p>
      <div className="hangar-table-scroll" tabIndex={0} role="region" aria-label="四款无人机参数对比，可左右滚动">
        <table className="hangar-table" aria-label={`硬件参考与${previewMode === 'assisted' ? '辅助' : '运动'}模式模拟性能`}>
          <thead><tr><th scope="col">参数</th>{DRONES.map(drone => <th key={drone.id} scope="col" className={selectedId === drone.id ? 'selected-column' : ''}>{drone.name}{droneId === drone.id ? <small>当前机型</small> : null}</th>)}</tr></thead>
          <tbody><tr className="hangar-table-section"><th colSpan={5}>硬件参考设定</th></tr>{hardwareRows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{DRONES.map(drone => <td key={drone.id} className={selectedId === drone.id ? 'selected-column' : ''}>{row.value(drone)}</td>)}</tr>)}</tbody>
          <tbody><tr className="hangar-table-section"><th colSpan={5}>游戏模拟 · {previewMode === 'assisted' ? '辅助' : '运动'}模式</th></tr>{performanceRows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{DRONES.map((drone, index) => <td key={drone.id} className={selectedId === drone.id ? 'selected-column' : ''}>{row.values[index]}</td>)}</tr>)}</tbody>
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
