import { useEffect, useId, useMemo, useState } from 'react';
import type { RaceMode, Telemetry } from '../game/types';
import { CHECKPOINTS } from '../game/world';
import { TARGETS } from '../game/weapons';
import { LAKES, RIVER_SAMPLES, WORLD_BOUNDS, lakeBoundary } from '../game/landscape';
import { BRIDGES, CABINS, FISH_SCHOOLS } from '../game/rural-layout';
import './Minimap.css';

interface MinimapProps {
  telemetry: Telemetry;
  mode: RaceMode;
}

type MapView = 'world' | 'route';
interface MapBounds { minX: number; maxX: number; minZ: number; maxZ: number }
interface MapPoint { x: number; y: number }

const ROUTE_BOUNDS: MapBounds = { minX: -250, maxX: 350, minZ: -600, maxZ: 150 };
const MAP_PADDING = 13;
const MAP_WIDTH = 180;
const MAP_HEIGHT = 150;

function createProjection(bounds: MapBounds) {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const scale = Math.min((MAP_WIDTH - MAP_PADDING * 2) / width, (MAP_HEIGHT - MAP_PADDING * 2) / depth);
  const left = (MAP_WIDTH - width * scale) / 2;
  const top = (MAP_HEIGHT - depth * scale) / 2;
  return {
    left, top, width: width * scale, height: depth * scale,
    project: (x: number, z: number): MapPoint => ({ x: left + (x - bounds.minX) * scale, y: top + (z - bounds.minZ) * scale }),
  };
}

function closedPath(points: MapPoint[]) {
  return points.length ? `M ${points.map(({ x, y }) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z` : '';
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export default function Minimap({ telemetry, mode }: MinimapProps) {
  const [mapView, setMapView] = useState<MapView>(mode === 'race' ? 'route' : 'world');
  const instanceId = useId();
  const clipId = `${instanceId}-map-clip`;
  const gridId = `${instanceId}-map-grid`;
  useEffect(() => { setMapView(mode === 'race' ? 'route' : 'world'); }, [mode]);

  const bounds = mapView === 'world' ? WORLD_BOUNDS : ROUTE_BOUNDS;
  const geography = useMemo(() => {
    const projection = createProjection(bounds);
    const riverBanks = RIVER_SAMPLES.map((sample, index) => {
      const previous = RIVER_SAMPLES[Math.max(0, index - 1)];
      const next = RIVER_SAMPLES[Math.min(RIVER_SAMPLES.length - 1, index + 1)];
      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const length = Math.hypot(dx, dz) || 1;
      const normalX = dz / length;
      const normalZ = -dx / length;
      return {
        left: projection.project(sample.x - normalX * sample.halfWidth, sample.z - normalZ * sample.halfWidth),
        right: projection.project(sample.x + normalX * sample.halfWidth, sample.z + normalZ * sample.halfWidth),
      };
    });
    const riverLabel = RIVER_SAMPLES[Math.floor(RIVER_SAMPLES.length / 2)];
    return {
      ...projection,
      riverPath: closedPath([...riverBanks.map(bank => bank.left), ...riverBanks.reverse().map(bank => bank.right)]),
      riverLabel: riverLabel ? projection.project(riverLabel.x, riverLabel.z) : null,
      lakes: LAKES.map(lake => ({
        id: lake.id,
        name: lake.name,
        position: projection.project(lake.x, lake.z),
        path: closedPath(lakeBoundary(lake, 96).map(point => projection.project(point.x, point.z))),
      })),
      fishSchools: FISH_SCHOOLS.filter(school => school.points.length > 0).map(school => {
        const center = school.points.reduce((sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }), { x: 0, z: 0 });
        return {
          id: school.id,
          count: school.count,
          position: projection.project(center.x / school.points.length, center.z / school.points.length),
        };
      }),
    };
  }, [bounds]);

  const points = CHECKPOINTS.map(({ position }) => geography.project(position.x, position.z));
  const start = geography.project(0, 55);
  const outsideRoute = mapView === 'route' && (
    telemetry.position.x < bounds.minX || telemetry.position.x > bounds.maxX
    || telemetry.position.z < bounds.minZ || telemetry.position.z > bounds.maxZ
  );
  const drone = geography.project(
    clamp(telemetry.position.x, bounds.minX, bounds.maxX),
    clamp(telemetry.position.z, bounds.minZ, bounds.maxZ),
  );
  const target = CHECKPOINTS[telemetry.checkpoint];
  const distance = target ? Math.round(Math.hypot(
    target.position.x - telemetry.position.x,
    target.position.y - telemetry.position.y,
    target.position.z - telemetry.position.z,
  )) : 0;
  const course = [start, ...points].map(({ x, y }) => `${x},${y}`).join(' ');
  const isWorld = mapView === 'world';

  return (
    <div className={`minimap geographic-minimap${isWorld ? ' minimap-world' : ''}`} aria-label="小地图，河流、湖泊、小屋、小桥、鱼群、当前位置、检查点与投弹靶标">
      <div className="map-heading">
        <div className="minimap-modes" role="group" aria-label="地图范围">
          <button type="button" aria-pressed={isWorld} onClick={() => setMapView('world')} title="查看整个自然飞行场">全域</button>
          <button type="button" aria-pressed={!isWorld} onClick={() => setMapView('route')} title="放大查看飞行航线">航线</button>
        </div>
        <span>N ↑</span>
      </div>
      <svg viewBox="0 0 180 150" role="img" aria-label={`${isWorld ? '全域地图' : '航线地图'}，蓝色为河流湖泊，浅蓝鱼形标记为鱼群，米色为小屋和桥，橙色为未命中靶标${outsideRoute ? '；当前位置超出航线图范围，可切换全域查看' : ''}`}>
        <defs>
          <pattern id={gridId} width="30" height="25" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 25" fill="none" stroke="currentColor" strokeOpacity="0.09" strokeWidth="0.6" />
          </pattern>
          <clipPath id={clipId}>
            <rect x={geography.left} y={geography.top} width={geography.width} height={geography.height} rx="3" />
          </clipPath>
        </defs>
        <rect x={geography.left} y={geography.top} width={geography.width} height={geography.height} rx="3" fill="#273e2d" fillOpacity="0.65" stroke="#a5b89a" strokeOpacity="0.16" strokeWidth="0.6" />
        <g clipPath={`url(#${clipId})`}>
          <rect width="180" height="150" fill={`url(#${gridId})`} />
          <path d={geography.riverPath} fill="#6094a8" fillOpacity="0.7" stroke="#93c4d0" strokeOpacity="0.55" strokeWidth="0.65"><title>河流</title></path>
          {geography.lakes.map(lake => <path key={lake.id} d={lake.path} fill="#6094a8" fillOpacity="0.78" stroke="#93c4d0" strokeOpacity="0.65" strokeWidth="0.65"><title>{lake.name}</title></path>)}
          {isWorld && <g className="minimap-water-labels" fontSize="6.5" fill="#e3f3f5" textAnchor="middle">
            {geography.lakes.map(lake => <text key={lake.id} x={lake.position.x} y={lake.position.y + 2}>{lake.name}</text>)}
            {geography.riverLabel && <text x={geography.riverLabel.x - 6} y={geography.riverLabel.y} textAnchor="end">河流</text>}
          </g>}
          {CABINS.map(cabin => {
            const point = geography.project(cabin.x, cabin.z);
            return <g key={cabin.id} transform={`translate(${point.x} ${point.y}) scale(${isWorld ? 0.45 : 0.7})`}>
              <title>{cabin.name}，乡间小屋</title>
              <path d="M -5 0 L 0 -4 L 5 0 L 5 5 L -5 5 Z" fill="#dcca9b" stroke="#243329" strokeWidth="1" />
              <path d="M -1 5 L -1 2 L 1 2 L 1 5" fill="#3c4631" />
            </g>;
          })}
          {BRIDGES.map(bridge => {
            const point = geography.project(bridge.x, bridge.z);
            return <g key={bridge.id} transform={`translate(${point.x} ${point.y}) rotate(${-bridge.yaw * 180 / Math.PI}) scale(${isWorld ? 0.55 : 0.85})`}>
              <title>{bridge.name}，跨河小桥</title>
              <path d="M -6 -2 L 6 -2 L 6 2 L -6 2 Z" fill="#dcca9b" stroke="#243329" strokeWidth="1" />
              <path d="M -4 -4 L -4 4 M 4 -4 L 4 4" stroke="#eddfb8" strokeWidth="1.2" />
            </g>;
          })}
          {geography.fishSchools.map(school => <g key={school.id}
            transform={`translate(${school.position.x} ${school.position.y}) scale(${isWorld ? 0.65 : 0.85})`}
            role="img" aria-label={`鱼群，${school.count} 条，低空悬停并切换俯视观察`}>
            <title>鱼群，{school.count} 条。靠近鱼标后低空悬停，按 V 切换俯视观察。</title>
            <path d="M -4 0 C -1 -4 3 -4 6 0 C 3 4 -1 4 -4 0 L -7 -3 L -7 3 Z" fill="#b7eefa" stroke="#213e38" strokeWidth="0.8" strokeLinejoin="round" />
            <circle cx="3" cy="-0.6" r="0.6" fill="#213e38" />
          </g>)}
          <polyline points={course} fill="none" stroke="currentColor" strokeOpacity={isWorld ? 0.45 : 0.55} strokeWidth={isWorld ? 0.8 : 1.3} strokeDasharray={isWorld ? '2 2' : '3 4'} />
          {points.map((point, index) => {
            const passed = mode === 'race' && index < telemetry.checkpoint;
            const active = mode === 'race' && index === telemetry.checkpoint;
            return <g key={index}>
              {active && <circle cx={point.x} cy={point.y} r={isWorld ? 4 : 8} fill="none" stroke="#c8ff5f" strokeOpacity="0.35" strokeWidth="1" />}
              <circle cx={point.x} cy={point.y} r={isWorld ? active ? 2.2 : 1.3 : active ? 4.4 : 3}
                fill={active ? '#17221b' : passed ? '#c8ff5f' : '#f1f6f2'} fillOpacity={passed || active ? 1 : 0.65}
                stroke={passed || active ? '#c8ff5f' : '#f1f6f2'} strokeWidth={active ? isWorld ? 0.9 : 1.8 : 0.6}>
                <title>检查点 {index + 1}{passed ? '，已通过' : active ? '，下一个目标' : ''}</title>
              </circle>
              {!isWorld && <text x={point.x + 7} y={point.y + 3} fontSize="8" fill="currentColor" fillOpacity={active ? 1 : 0.5}>{index + 1}</text>}
            </g>;
          })}
          {TARGETS.map(target => {
            const point = geography.project(target.position.x, target.position.z);
            const hit = telemetry.weapons.hitTargetIds.includes(target.id);
            const radius = isWorld ? 2.4 : 6;
            return <g key={target.id} transform={`translate(${point.x} ${point.y})`}>
              <title>{hit ? '已命中靶标' : '投弹靶标'}</title>
              <path d={`M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`} fill={hit ? '#dff781' : '#ec9b60'} fillOpacity={hit ? 0.45 : 0.9} stroke="#243329" strokeWidth={isWorld ? 0.5 : 1} />
            </g>;
          })}
        </g>
        <g transform={`translate(${drone.x} ${drone.y}) rotate(${-telemetry.yaw * 180 / Math.PI})`}>
          <title>{outsideRoute ? '当前位置超出航线图范围，切换全域地图查看' : '无人机当前位置'}</title>
          <circle r="9" fill="#c8ff5f" fillOpacity="0.12" />
          <path d="M 0 -7 L 5 5 L 0 3 L -5 5 Z" fill={outsideRoute ? '#17221b' : '#c8ff5f'} stroke={outsideRoute ? '#c8ff5f' : '#17221b'} strokeWidth="1" />
        </g>
      </svg>
      <div className="map-distance">
        <span>{outsideRoute ? '范围外' : mode === 'free' ? '探索范围' : target ? '下个检查点' : '航线完成'}</span>
        <strong>{outsideRoute ? '切换全域' : mode === 'race' && target ? `${distance} m` : mode === 'race' ? '8 / 8' : `${((bounds.maxX - bounds.minX) / 1000).toFixed(1)} km`}</strong>
      </div>
      <div className="map-discovery" aria-label="浅蓝鱼形标记是鱼群，沿河飞到木桥下游，低空悬停，按 V 或手机视角按钮切换俯视观察">
        <svg viewBox="-8 -4 15 8" aria-hidden="true"><path d="M -4 0 C -1 -4 3 -4 6 0 C 3 4 -1 4 -4 0 L -7 -3 L -7 3 Z" fill="currentColor" /></svg>
        <span>鱼群 · V 俯视</span>
      </div>
    </div>
  );
}
