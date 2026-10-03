import type { RaceMode, Telemetry } from '../game/types';
import { formatTime } from '../game/types';
export default function TelemetryBar({ telemetry, mode }: { telemetry: Telemetry; mode: RaceMode }) {
  return <section className="telemetry" aria-label="实时飞行仪表">
    <div className="metric" title={`相对地面速度；空速 ${telemetry.airSpeed.toFixed(1)} km/h`}><span>地速</span><div><strong data-testid="speed">{Math.round(telemetry.speed)}</strong><small>km/h</small></div></div>
    <div className="metric"><span>高度</span><div><strong data-testid="altitude">{Math.round(telemetry.altitude)}</strong><small>m</small></div></div>
    <div className="metric"><span>{mode === 'race' ? '检查点' : '飞行模式'}</span><div><strong className="checkpoint-value" data-testid="checkpoint">{mode === 'race' ? `${String(telemetry.checkpoint).padStart(2, '0')} / 08` : '自由'}</strong></div></div>
    <div className="metric"><span>飞行时间</span><div><strong className="timer-value" data-testid="timer">{formatTime(telemetry.elapsed)}</strong></div></div>
  </section>;
}
