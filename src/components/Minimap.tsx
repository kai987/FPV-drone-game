import type { RaceMode, Telemetry } from '../game/types';
import { CHECKPOINTS } from '../game/world';

interface MinimapProps {
  telemetry: Telemetry;
  mode: RaceMode;
}

const MAP_BOUNDS = { minX: -145, maxX: 130, minZ: -455, maxZ: 55 };
const MAP_PADDING = 13;
const MAP_WIDTH = 180;
const MAP_HEIGHT = 150;

function mapPosition(x: number, z: number) {
  return {
    x: MAP_PADDING + ((x - MAP_BOUNDS.minX) / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX)) * (MAP_WIDTH - MAP_PADDING * 2),
    y: MAP_PADDING + ((z - MAP_BOUNDS.minZ) / (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ)) * (MAP_HEIGHT - MAP_PADDING * 2),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export default function Minimap({ telemetry, mode }: MinimapProps) {
  const points = CHECKPOINTS.map(({ position }) => mapPosition(position.x, position.z));
  const start = mapPosition(0, 55);
  const drone = mapPosition(
    clamp(telemetry.position.x, MAP_BOUNDS.minX, MAP_BOUNDS.maxX),
    clamp(telemetry.position.z, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ),
  );
  const target = CHECKPOINTS[telemetry.checkpoint];
  const distance = target
    ? Math.round(Math.hypot(
      target.position.x - telemetry.position.x,
      target.position.y - telemetry.position.y,
      target.position.z - telemetry.position.z,
    ))
    : 0;
  const course = [start, ...points].map(({ x, y }) => `${x},${y}`).join(' ');

  return (
    <div className="minimap" aria-label="小地图，当前位置与检查点">
      <div className="map-heading"><span>航线</span><span>N ↑</span></div>
      <svg viewBox="0 0 180 150" role="img" aria-label="无人机当前位置与八个航线检查点">
        <defs>
          <pattern id="map-grid" width="30" height="25" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 25" fill="none" stroke="currentColor" strokeOpacity="0.09" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="180" height="150" fill="url(#map-grid)" />
        <polyline points={course} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.3" strokeDasharray="3 4" />
        {points.map((point, index) => {
          const passed = mode === 'race' && index < telemetry.checkpoint;
          const active = mode === 'race' && index === telemetry.checkpoint;
          return (
            <g key={index}>
              {active && <circle cx={point.x} cy={point.y} r="8" fill="none" stroke="#c8ff5f" strokeOpacity="0.35" strokeWidth="1" />}
              <circle
                cx={point.x}
                cy={point.y}
                r={active ? 4.4 : 3}
                fill={active ? '#17221b' : passed ? '#c8ff5f' : '#f1f6f2'}
                fillOpacity={passed || active ? 1 : 0.65}
                stroke={passed || active ? '#c8ff5f' : '#f1f6f2'}
                strokeWidth={active ? 1.8 : 0.6}
              />
              <text x={point.x + 7} y={point.y + 3} fontSize="8" fill="currentColor" fillOpacity={active ? 1 : 0.5}>{index + 1}</text>
            </g>
          );
        })}
        <g transform={`translate(${drone.x} ${drone.y}) rotate(${-telemetry.yaw * 180 / Math.PI})`}>
          <circle r="9" fill="#c8ff5f" fillOpacity="0.12" />
          <path d="M 0 -7 L 5 5 L 0 3 L -5 5 Z" fill="#c8ff5f" stroke="#17221b" strokeWidth="1" />
        </g>
      </svg>
      <div className="map-distance">
        <span>{mode === 'free' ? '自由探索' : target ? '下个检查点' : '航线完成'}</span>
        <strong>{mode === 'race' && target ? `${distance} m` : mode === 'race' ? '8 / 8' : '∞'}</strong>
      </div>
    </div>
  );
}
