import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, ChevronDown, Drone, Maximize, Minimize, Moon, Pause, Play, RotateCcw, Sun, Volume2, VolumeX, Trophy, Wind } from 'lucide-react';
import { FlightEngine } from './game/engine';
import type { MapLoadProgress } from './game/map-cache';
import { loadFlightCore } from './game/load-flight-core';
import { DEFAULT_MAP_ID, MAPS, getMapSpec } from './game/map-catalog';
import type { MapId } from './game/map-catalog';
import { EMPTY_TELEMETRY, formatTime } from './game/types';
import type { CameraMode, FlightMode, RaceMode, Status } from './game/types';
import ControlsGuide, { CompactControls } from './components/ControlsGuide';
import TelemetryBar from './components/TelemetryBar';
import Minimap from './components/Minimap';
import TouchControls from './components/TouchControls';
import WeaponPanel from './components/WeaponPanel';
import DroneHangar from './components/DroneHangar';
import { DEFAULT_DRONE_ID, getDroneSpec } from './game/drone-catalog';
import type { DroneId } from './game/drone-catalog';

import { DEFAULT_WIND_SETTINGS } from './game/wind';
import type { WindSettings } from './game/wind';
import { bestTimeKey, readBestTime } from './game/records';
import WindPanel, { WindSettingsDialog } from './components/WindPanel';

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<FlightEngine | null>(null);
  const noticeTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hangarTrigger = useRef<HTMLButtonElement>(null);
  const guideTrigger = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<Status>('ready');
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);
  const [mode, setMode] = useState<RaceMode>('race');
  const [flightMode, setFlightMode] = useState<FlightMode>('assisted');
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [sound, setSound] = useState(false);
  const [night, setNight] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [guide, setGuide] = useState(false);
  const [hangar, setHangar] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [windSettings, setWindSettings] = useState<WindSettings>({ ...DEFAULT_WIND_SETTINGS });
  const [droneId, setDroneId] = useState<DroneId>(DEFAULT_DRONE_ID);
  const [mapId, setMapId] = useState<MapId>(DEFAULT_MAP_ID);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [mapProgress, setMapProgress] = useState<MapLoadProgress<MapId>>({ ready: [], current: null, total: MAPS.length });
  const [best, setBest] = useState<Record<string, number>>({});
  const [finishedRecordKey, setFinishedRecordKey] = useState<string | null>(null);
  const settingsLocked = status === 'flying' || status === 'paused';
  const selectedDrone = getDroneSpec(droneId);
  const selectedMap = getMapSpec(mapId);
  const settings = useRef({ mode, flightMode, droneId, windSettings, night, sound, cameraMode, mapId });
  settings.current = { mode, flightMode, droneId, windSettings, night, sound, cameraMode, mapId };
  const personalBest = useMemo(() => {
    const cached = best[bestTimeKey(droneId, flightMode, windSettings, mapId)];
    if (cached !== undefined) return cached;
    try { return readBestTime(localStorage, droneId, flightMode, windSettings, mapId); } catch { return null; }
  }, [best, droneId, flightMode, windSettings, mapId]);
  const notify = (message: string) => {
    setNotice(message); clearTimeout(noticeTimeout.current);
    noticeTimeout.current = setTimeout(() => setNotice(''), 3600);
  };
  useEffect(() => {
    let cancelled = false;
    const loading = new AbortController();
    const loadingStarted = performance.now();
    let game: FlightEngine | null = null;
    setLoaded(false); setError(''); setNotice(''); setFinishedRecordKey(null);
    setMapProgress({ ready: [], current: null, total: MAPS.length });
    setStatus('ready');
    const map = getMapSpec(settings.current.mapId);
    setTelemetry({ ...EMPTY_TELEMETRY, position: { ...map.spawn }, yaw: map.spawnYaw });
    clearTimeout(noticeTimeout.current);
    void (async () => {
      if (cancelled || !host.current) return;
      try {
        game = await FlightEngine.create(host.current, {
          telemetry: value => { if (!cancelled) setTelemetry(value); },
          status: value => { if (!cancelled) setStatus(value); },
          notice: value => { if (!cancelled) notify(value); },
          cameraMode: value => { if (!cancelled) setCameraMode(value); },
          finish: seconds => {
            if (cancelled || !game || engine.current !== game) return;
            const currentMode = game.flightMode;
            const currentDrone = game.droneId;
            const weather = game.windSettings;
            const currentMap = game.mapId;
            const key = bestTimeKey(currentDrone, currentMode, weather, currentMap);
            setFinishedRecordKey(key);
            if (!game.recordEligible) return;
            setBest(current => {
              let previousBest: number | null = Object.hasOwn(current, key) ? current[key] : null;
              try { previousBest ??= readBestTime(localStorage, currentDrone, currentMode, weather, currentMap); } catch { /* Optional storage. */ }
              if (previousBest !== null && previousBest <= seconds) return current;
              try { localStorage.setItem(key, String(seconds)); } catch { /* Optional personal record. */ }
              return { ...current, [key]: seconds };
            });
          },
        }, loadFlightCore(), settings.current.mapId, loading.signal, loadingStarted);
        if (cancelled) { game.dispose(); return; }
        engine.current = game;
        const current = settings.current;
        game.mode = current.mode; game.flightMode = current.flightMode;
        game.setDrone(current.droneId);
        game.setWind(current.windSettings); game.setNight(current.night); game.setCameraMode(current.cameraMode);
        await game.preloadMaps(progress => { if (!cancelled) setMapProgress(progress); });
        if (cancelled) return;
        setNotice(''); clearTimeout(noticeTimeout.current);
        const activeGame = game;
        void activeGame.audio.enable(settings.current.sound).catch(() => {
          if (!cancelled && engine.current === activeGame && settings.current.sound) {
            setSound(false); notify('浏览器暂未允许声音播放');
          }
        });
        setLoaded(true);
      } catch (failure) {
        game?.dispose();
        if (engine.current === game) engine.current = null;
        if (!cancelled) setError(failure instanceof Error && failure.message.startsWith('飞行模块加载失败')
          ? failure.message
          : failure instanceof Error && failure.message.startsWith('地图纹理加载失败')
          ? `${failure.message}。请检查网络连接后重新加载。`
          : '当前浏览器无法启动 3D 画面。请启用硬件加速，或使用支持 WebGL 2 的新版 Chrome、Edge 或 Safari。');
      }
    })();
    return () => {
      cancelled = true; loading.abort(); clearTimeout(noticeTimeout.current); game?.dispose();
      if (engine.current === game) engine.current = null;
    };
  }, []);
  useEffect(() => { if (engine.current) { engine.current.mode = mode; engine.current.flightMode = flightMode; } }, [mode, flightMode, loaded]);
  useEffect(() => { engine.current?.setWind(windSettings); }, [windSettings, loaded]);
  useEffect(() => { engine.current?.setNight(night); }, [night, loaded]);
  useEffect(() => {
    const switchDayNight = (event: KeyboardEvent) => {
      if (event.code !== 'KeyN' || event.repeat || event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('dialog[open], input, textarea, select, [role="textbox"]'))) return;
      event.preventDefault();
      setNight(current => !current);
    };
    window.addEventListener('keydown', switchDayNight);
    return () => window.removeEventListener('keydown', switchDayNight);
  }, []);
  useEffect(() => { const listener = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', listener); return () => document.removeEventListener('fullscreenchange', listener); }, []);
  const action = () => { if (status === 'paused' || status === 'flying') engine.current?.togglePause(); else engine.current?.start(); };
  const openHangar = () => {
    hangarTrigger.current?.focus({ preventScroll: true });
    engine.current?.pause(); setHangar(true);
  };
  const openWeather = () => { engine.current?.pause(); setWeatherOpen(true); };
  const applyWind = (settings: WindSettings) => {
    engine.current?.setWind(settings); setWindSettings(settings); setWeatherOpen(false);
    notify(settingsLocked ? '风况已更新 · 继续飞行体验风偏' : '风况已更新 · 准备起飞');
  };
  const applyDrone = (id: DroneId, returnToStart: boolean) => {
    const game = engine.current;
    if (!game) return;
    if (returnToStart) game.reset();
    if (!game.setDrone(id)) { notify('请先返回起点，再切换机型'); return; }
    setDroneId(game.droneId); setHangar(false);
    notify(`已选用 ${getDroneSpec(game.droneId).name} · 准备起飞`);
  };
  const changeMode = (value: RaceMode) => { setMode(value); engine.current?.reset(); };
  const changeMap = (value: MapId) => {
    if (value === mapId || !loaded || !engine.current?.setMap(value)) return;
    clearTimeout(noticeTimeout.current); setNotice(''); setFinishedRecordKey(null); setMapId(value);
  };
  const toggleSound = () => {
    const enabled = !sound; const game = engine.current; setSound(enabled);
    void game?.audio.enable(enabled).catch(() => {
      if (engine.current === game && settings.current.sound === enabled) { setSound(false); notify('浏览器暂未允许声音播放'); }
    });
  };
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('此浏览器暂不支持全屏，可使用浏览器的全屏功能'); }
  };
  const next = selectedMap.checkpoints[telemetry.checkpoint];
  const distance = next ? Math.round(Math.hypot(next.position.x - telemetry.position.x, next.position.y - telemetry.position.y, next.position.z - telemetry.position.z)) : 0;
  const cameraLabels = { chase: '追尾视角', bomb: '俯视瞄准', fpv: '第一视角' };
  const nextCamera = cameraMode === 'chase' ? 'bomb' : cameraMode === 'bomb' ? 'fpv' : 'chase';

  return <div className={`app-shell${night ? ' night' : ''}`}>
    <header className="topbar">
      <a className="brand" href="./" aria-label="AEROFLOW 首页"><Drone size={32} strokeWidth={1.8} /><span>AEROFLOW</span></a>
      <nav aria-label="主导航"><button className={!guide ? 'nav-link selected' : 'nav-link'} onClick={() => setGuide(false)}>飞行场</button><button ref={guideTrigger} className={guide ? 'nav-link selected' : 'nav-link'} onClick={() => { guideTrigger.current?.focus({ preventScroll: true }); engine.current?.pause(); setGuide(true); }}>操作指南</button></nav>
      <div className="header-actions"><button ref={hangarTrigger} className="drone-hangar-toggle" type="button" aria-label={`${selectedDrone.name}，打开机库与参数`} title={`${selectedDrone.name} · 机库与参数`} aria-haspopup="dialog" aria-expanded={hangar} onClick={openHangar}><Drone size={16} aria-hidden="true" /><span className="hangar-entry-label">机库</span><span className="hangar-entry-model">{selectedDrone.name}</span><ChevronDown size={12} aria-hidden="true" /></button><button className="day-night-toggle" type="button" aria-label={night ? '切换到日间' : '切换到夜间'} aria-pressed={night} title={`N · ${night ? '切换到日间' : '切换到夜间'}`} onClick={() => setNight(current => !current)}>{night ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}<span>{night ? '夜间' : '日间'}</span></button><button className="icon-button" aria-label={sound ? '关闭声音' : '开启声音'} aria-pressed={sound} onClick={toggleSound}>{sound ? <Volume2 size={21} /> : <VolumeX size={21} />}</button><span className="vertical-rule" /><button className="icon-button" aria-label={fullscreen ? '退出全屏' : '进入全屏'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}</button></div>
    </header>
    <main className="game-layout">
      <aside className="sidebar">
        <div className="intro"><h1>把视野<br />交给天空。</h1><p>{selectedMap.description}</p></div>
        <section className="course-settings" aria-label="飞行设置">
          <h2><span>{selectedMap.number} /</span> {selectedMap.name}</h2>
          <div className="course-meta"><span>{selectedMap.checkpoints.length} 检查点</span><i /><span>{selectedMap.areaLabel}</span><i /><span>{selectedMap.themeLabel}</span></div>
          <div className="map-selector">
            <div className="segment-control" role="group" aria-label="选择飞行地图" aria-describedby="map-switch-help">{MAPS.map(map => <button key={map.id} type="button" disabled={!loaded || Boolean(error)} aria-label={`切换到${map.name}`} aria-pressed={mapId === map.id} className={mapId === map.id ? 'active' : ''} title={`${map.name} · 切换地图会返回起点`} onClick={() => changeMap(map.id)}>{map.id === 'valley' ? '山谷' : map.id === 'factory' ? '工厂' : '海港'}</button>)}</div>
            <p id="map-switch-help" className="map-switch-help">{loaded ? '3 张地图已就绪 · 切换会返回起点' : '首次进入将准备全部 3 张地图'}</p>
          </div>
          <div className="segment-control" role="group" aria-label="游戏模式"><button disabled={settingsLocked} aria-pressed={mode === 'race'} className={mode === 'race' ? 'active' : ''} onClick={() => changeMode('race')}>计时挑战</button><button disabled={settingsLocked} aria-pressed={mode === 'free'} className={mode === 'free' ? 'active' : ''} onClick={() => changeMode('free')}>自由飞行</button></div>
          <h3 className="setting-label">飞行模式</h3>
          <div className="segment-control" role="group" aria-label="飞行模式"><button disabled={settingsLocked} aria-pressed={flightMode === 'assisted'} className={flightMode === 'assisted' ? 'active' : ''} onClick={() => { setFlightMode('assisted'); engine.current?.reset(); }}>辅助</button><button disabled={settingsLocked} aria-pressed={flightMode === 'sport'} className={flightMode === 'sport' ? 'active' : ''} onClick={() => { setFlightMode('sport'); engine.current?.reset(); }}>运动</button></div>
          <button className="primary-button launch-button" onClick={action} disabled={!loaded || Boolean(error)}>{status === 'flying' ? '暂停飞行' : status === 'paused' ? '继续飞行' : status === 'finished' ? '再飞一次' : '开始飞行'}{status === 'flying' ? <Pause size={19} /> : <ArrowRight size={21} />}</button>
          {status === 'ready' ? <p className="launch-note">无需下载，即刻起飞</p> : <button className="text-button reset-button" onClick={() => engine.current?.reset()}><RotateCcw size={13} /> 返回起点</button>}
          {personalBest ? <div className="personal-best" title={`${selectedMap.name} · ${selectedDrone.name} · ${flightMode === 'assisted' ? '辅助' : '运动'}模式`}><Trophy size={14} /><span>本图 · 同风况最佳</span><strong>{formatTime(personalBest)}</strong></div> : null}
        </section>
        <CompactControls />
      </aside>
      <section className={`flight-region status-${status}`} aria-label={`${selectedMap.name}无人机飞行场`}>
        <div className="viewport" data-testid="viewport">
          <div className="canvas-host" ref={host} />
          <div className="scene-heading"><span className="scene-number">{selectedMap.number}</span><div><strong>{selectedMap.name}</strong><small>{selectedMap.englishName}</small></div></div>
          <button className="fpv-mark view-toggle" aria-label={`切换到${cameraLabels[nextCamera]}`} title="按 V 切换追尾、俯视瞄准、第一视角" onClick={() => engine.current?.cycleCameraMode()}><Camera size={15} /><span>{cameraLabels[cameraMode]}</span><span className="view-key">V</span></button>
          <div className={`crosshair ${cameraMode === 'chase' ? 'chase-crosshair' : ''}`} aria-hidden="true" />
          {status === 'flying' && mode === 'race' ? <div className="target-indicator"><span className="target-dot" />下一检查点 {String(telemetry.checkpoint + 1).padStart(2, '0')}<span className="target-distance">{distance} m</span></div> : null}
          {!loaded && !error ? <div className="scene-loading" role="status" aria-live="polite"><Wind size={28} /><span>正在准备全部地图 · {mapProgress.ready.length} / {mapProgress.total}</span><progress aria-label="地图准备进度" value={mapProgress.ready.length} max={mapProgress.total} /><small className="map-load-details">{MAPS.map(map => `${map.name} ${mapProgress.ready.includes(map.id) ? '✓' : mapProgress.current === map.id ? '加载中' : '待加载'}`).join(' · ')}</small></div> : null}
          {error ? <div className="state-overlay"><div className="state-panel"><h2>画面暂不可用</h2><p>{error}</p><button className="primary-button" onClick={() => location.reload()}>重新加载</button></div></div> : null}
          {status === 'paused' ? <div className="state-overlay"><div className="state-panel pause-panel"><Pause className="state-icon" size={30} /><h2>让风等你一下。</h2><p>飞行已暂停，按 P 或点击下方继续。</p><button className="primary-button" onClick={action}><Play size={17} />继续飞行</button><button className="text-button" onClick={() => engine.current?.reset()}>返回起点</button></div></div> : null}
          {status === 'finished' ? <div className="state-overlay"><div className="state-panel finish-panel"><Trophy className="state-icon" size={32} /><h2>漂亮的一次飞行。</h2><p>{selectedMap.checkpoints.length} 个检查点全部完成</p><strong className="finish-time">{formatTime(telemetry.elapsed)}</strong><div className="finish-best">{!telemetry.recordEligible ? '本轮调整过风况，不计入个人最佳' : finishedRecordKey === bestTimeKey(droneId, flightMode, windSettings, mapId) ? `本图同风况最佳 · ${formatTime(personalBest ?? telemetry.elapsed)}` : '本轮已完成 · 新风况用于下次起飞'}</div><button className="primary-button" onClick={() => engine.current?.start()}>再飞一次<ArrowRight size={19} /></button><button className="text-button" onClick={() => { setMode('free'); if (engine.current) { engine.current.mode = 'free'; engine.current.start(); } }}>在{selectedMap.name}自由探索</button></div></div> : null}
          <div className={`flight-notice ${notice ? 'visible' : ''}`} role="status">{notice}</div>
          <WindPanel wind={telemetry.wind} airSpeed={telemetry.airSpeed} onOpen={openWeather} />
          <Minimap key={mapId} mapId={mapId} telemetry={telemetry} mode={mode} />
          <WeaponPanel ammo={telemetry.weapons.ammo} reloadRemaining={telemetry.weapons.reloadRemaining} score={telemetry.weapons.score} hits={telemetry.weapons.hitTargetIds.length} status={status} onDrop={() => engine.current?.dropBomb()} />
          {status === 'flying' ? <TouchControls onAxis={(axis, value) => engine.current?.setTouch(axis, value)} /> : null}
          {status === 'flying' ? <button className="mobile-pause icon-button" aria-label="暂停飞行" onClick={() => engine.current?.pause()}><Pause size={19} /></button> : null}
        </div>
        <TelemetryBar telemetry={telemetry} mode={mode} />
      </section>
    </main>
    {weatherOpen ? <WindSettingsDialog settings={windSettings} activeFlight={settingsLocked} onApply={applyWind} onClose={() => setWeatherOpen(false)} /> : null}
    {guide ? <ControlsGuide onClose={() => setGuide(false)} /> : null}
    {hangar ? <DroneHangar droneId={droneId} flightMode={flightMode} status={status} available={loaded && !error} onApply={applyDrone} onClose={() => setHangar(false)} /> : null}
  </div>;
}
