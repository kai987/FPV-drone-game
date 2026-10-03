import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Drone, Maximize, Minimize, Pause, Play, RotateCcw, Volume2, VolumeX, Trophy, Wind } from 'lucide-react';
import { FlightEngine } from './game/engine';
import { CHECKPOINTS } from './game/world';
import { EMPTY_TELEMETRY, formatTime } from './game/types';
import type { FlightMode, RaceMode, Status } from './game/types';
import ControlsGuide, { CompactControls } from './components/ControlsGuide';
import TelemetryBar from './components/TelemetryBar';
import Minimap from './components/Minimap';
import TouchControls from './components/TouchControls';

function readBest(): Record<FlightMode, number | null> {
  const result: Record<FlightMode, number | null> = { assisted: null, sport: null };
  try { for (const mode of ['assisted', 'sport'] as const) {
    const stored = localStorage.getItem(`aeroflow:v1:best:${mode}`);
    const value = stored === null ? NaN : Number(stored);
    if (Number.isFinite(value) && value > 0) result[mode] = value;
  } } catch { /* Flight remains available when storage is blocked. */ }
  return result;
}
export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<FlightEngine | null>(null);
  const noticeTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<Status>('ready');
  const [telemetry, setTelemetry] = useState(EMPTY_TELEMETRY);
  const [mode, setMode] = useState<RaceMode>('race');
  const [flightMode, setFlightMode] = useState<FlightMode>('assisted');
  const [sound, setSound] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [guide, setGuide] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [best, setBest] = useState(readBest);
  const settingsLocked = status === 'flying' || status === 'paused';
  const notify = (message: string) => {
    setNotice(message); clearTimeout(noticeTimeout.current);
    noticeTimeout.current = setTimeout(() => setNotice(''), 3600);
  };
  useEffect(() => {
    try {
      const game = new FlightEngine(host.current!, {
        telemetry: setTelemetry, status: setStatus, notice: notify,
        finish: seconds => {
          const currentMode = engine.current?.flightMode ?? 'assisted';
          setBest(current => {
            if (current[currentMode] !== null && current[currentMode]! <= seconds) return current;
            try { localStorage.setItem(`aeroflow:v1:best:${currentMode}`, String(seconds)); } catch { /* Optional personal record. */ }
            return { ...current, [currentMode]: seconds };
          });
        },
      });
      engine.current = game; setLoaded(true);
      return () => { clearTimeout(noticeTimeout.current); game.dispose(); engine.current = null; };
    } catch {
      setError('当前浏览器无法启动 3D 画面。请启用硬件加速，或使用支持 WebGL 2 的新版 Chrome、Edge 或 Safari。');
    }
  }, []);
  useEffect(() => { if (engine.current) { engine.current.mode = mode; engine.current.flightMode = flightMode; } }, [mode, flightMode]);
  useEffect(() => { const listener = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', listener); return () => document.removeEventListener('fullscreenchange', listener); }, []);
  const action = () => { if (status === 'paused' || status === 'flying') engine.current?.togglePause(); else engine.current?.start(); };
  const changeMode = (value: RaceMode) => { setMode(value); engine.current?.reset(); };
  const toggleSound = () => { const enabled = !sound; setSound(enabled); void engine.current?.audio.enable(enabled).catch(() => { setSound(false); notify('浏览器暂未允许声音播放'); }); };
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('此浏览器暂不支持全屏，可使用浏览器的全屏功能'); }
  };
  const next = CHECKPOINTS[telemetry.checkpoint];
  const distance = next ? Math.round(Math.hypot(next.position.x - telemetry.position.x, next.position.y - telemetry.position.y, next.position.z - telemetry.position.z)) : 0;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="./" aria-label="AEROFLOW 首页"><Drone size={32} strokeWidth={1.8} /><span>AEROFLOW</span></a>
      <nav aria-label="主导航"><button className={!guide ? 'nav-link selected' : 'nav-link'} onClick={() => setGuide(false)}>飞行场</button><button className={guide ? 'nav-link selected' : 'nav-link'} onClick={() => { engine.current?.pause(); setGuide(true); }}>操作指南</button></nav>
      <div className="header-actions"><button className="icon-button" aria-label={sound ? '关闭声音' : '开启声音'} aria-pressed={sound} onClick={toggleSound}>{sound ? <Volume2 size={21} /> : <VolumeX size={21} />}</button><span className="vertical-rule" /><button className="icon-button" aria-label={fullscreen ? '退出全屏' : '进入全屏'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}</button></div>
    </header>
    <main className="game-layout">
      <aside className="sidebar">
        <div className="intro"><h1>把视野<br />交给天空。</h1><p>穿越松林，在风中找到你的航线。</p></div>
        <section className="course-settings" aria-label="飞行设置">
          <h2><span>01 /</span> 松林山谷</h2>
          <div className="course-meta"><span>8 检查点</span><i /><span>1.2 km</span><i /><span>入门</span></div>
          <div className="segment-control" role="group" aria-label="游戏模式"><button disabled={settingsLocked} aria-pressed={mode === 'race'} className={mode === 'race' ? 'active' : ''} onClick={() => changeMode('race')}>计时挑战</button><button disabled={settingsLocked} aria-pressed={mode === 'free'} className={mode === 'free' ? 'active' : ''} onClick={() => changeMode('free')}>自由飞行</button></div>
          <h3 className="setting-label">飞行模式</h3>
          <div className="segment-control" role="group" aria-label="飞行模式"><button disabled={settingsLocked} aria-pressed={flightMode === 'assisted'} className={flightMode === 'assisted' ? 'active' : ''} onClick={() => { setFlightMode('assisted'); engine.current?.reset(); }}>辅助</button><button disabled={settingsLocked} aria-pressed={flightMode === 'sport'} className={flightMode === 'sport' ? 'active' : ''} onClick={() => { setFlightMode('sport'); engine.current?.reset(); }}>运动</button></div>
          <button className="primary-button launch-button" onClick={action} disabled={!loaded || Boolean(error)}>{status === 'flying' ? '暂停飞行' : status === 'paused' ? '继续飞行' : status === 'finished' ? '再飞一次' : '开始飞行'}{status === 'flying' ? <Pause size={19} /> : <ArrowRight size={21} />}</button>
          {status === 'ready' ? <p className="launch-note">无需下载，即刻起飞</p> : <button className="text-button reset-button" onClick={() => engine.current?.reset()}><RotateCcw size={13} /> 返回起点</button>}
          {best[flightMode] ? <div className="personal-best"><Trophy size={14} /><span>个人最佳</span><strong>{formatTime(best[flightMode]!)}</strong></div> : null}
        </section>
        <CompactControls />
      </aside>
      <section className={`flight-region status-${status}`} aria-label="无人机飞行场">
        <div className="viewport" data-testid="viewport">
          <div className="canvas-host" ref={host} />
          <div className="scene-heading"><span className="scene-number">01</span><div><strong>松林山谷</strong><small>PINE VALLEY</small></div></div>
          <div className="fpv-mark">FPV</div>
          <div className="crosshair" aria-hidden="true" />
          {status === 'flying' && mode === 'race' ? <div className="target-indicator"><span className="target-dot" />下一检查点 {String(telemetry.checkpoint + 1).padStart(2, '0')}<span className="target-distance">{distance} m</span></div> : null}
          {!loaded && !error ? <div className="scene-loading"><Wind size={28} /><span>正在准备山谷…</span></div> : null}
          {error ? <div className="state-overlay"><div className="state-panel"><h2>画面暂不可用</h2><p>{error}</p><button className="primary-button" onClick={() => location.reload()}>重新加载</button></div></div> : null}
          {status === 'paused' ? <div className="state-overlay"><div className="state-panel pause-panel"><Pause className="state-icon" size={30} /><h2>让风等你一下。</h2><p>飞行已暂停，按 P 或点击下方继续。</p><button className="primary-button" onClick={action}><Play size={17} />继续飞行</button><button className="text-button" onClick={() => engine.current?.reset()}>返回起点</button></div></div> : null}
          {status === 'finished' ? <div className="state-overlay"><div className="state-panel finish-panel"><Trophy className="state-icon" size={32} /><h2>漂亮的一次飞行。</h2><p>8 个检查点全部完成</p><strong className="finish-time">{formatTime(telemetry.elapsed)}</strong><div className="finish-best">个人最佳 · {formatTime(best[flightMode] ?? telemetry.elapsed)}</div><button className="primary-button" onClick={() => engine.current?.start()}>再飞一次<ArrowRight size={19} /></button><button className="text-button" onClick={() => { setMode('free'); if (engine.current) { engine.current.mode = 'free'; engine.current.start(); } }}>在山谷里自由探索</button></div></div> : null}
          <div className={`flight-notice ${notice ? 'visible' : ''}`} role="status">{notice}</div>
          <Minimap telemetry={telemetry} mode={mode} />
          {status === 'flying' ? <TouchControls onAxis={(axis, value) => engine.current?.setTouch(axis, value)} /> : null}
          {status === 'flying' ? <button className="mobile-pause icon-button" aria-label="暂停飞行" onClick={() => engine.current?.pause()}><Pause size={19} /></button> : null}
        </div>
        <TelemetryBar telemetry={telemetry} mode={mode} />
      </section>
    </main>
    {guide ? <ControlsGuide onClose={() => setGuide(false)} /> : null}
  </div>;
}
