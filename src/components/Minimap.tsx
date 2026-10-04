import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, SyntheticEvent } from 'react';
import type { RaceMode, Telemetry } from '../game/types';
import { LAKES, RIVER_SAMPLES, lakeBoundary } from '../game/landscape';
import { getMapSpec } from '../game/map-catalog';
import type { MapId } from '../game/map-catalog';
import { getMapLayout, HARBOR_PIERS, HARBOR_SHORE_X } from '../game/map-layout';
import type { UrbanBox } from '../game/map-layout';
import { BRIDGES, CABINS, FISH_SCHOOLS } from '../game/rural-layout';
import { beginMapDrag, centerMapBounds, clamp, createProjection, formatMapSpan, getMapBounds, getMapCenter, isOutsideBounds, panMapBounds, ZOOM_LEVELS } from './minimap-view.ts';
import type { MapBounds, MapPoint, MapPosition, MapView, MapViewportSize } from './minimap-view.ts';
import './Minimap.css';

interface MinimapProps {
  telemetry: Telemetry;
  mode: RaceMode;
  mapId: MapId;
}
type MapCameraMode = 'overview' | 'follow' | 'manual';
interface MapDrag {
  pointerId: number;
  startX: number;
  startY: number;
  bounds: MapBounds;
  viewport: MapViewportSize;
  element: SVGSVGElement;
  moved: boolean;
}

// Water boundaries and fish centers never change. Calculate them once rather
// than resampling the landscape for every frame of a following map.
const riverBanks = RIVER_SAMPLES.map((sample, index) => {
  const previous = RIVER_SAMPLES[Math.max(0, index - 1)];
  const next = RIVER_SAMPLES[Math.min(RIVER_SAMPLES.length - 1, index + 1)];
  const dx = next.x - previous.x; const dz = next.z - previous.z;
  const length = Math.hypot(dx, dz) || 1;
  const normalX = dz / length; const normalZ = -dx / length;
  return {
    left: { x: sample.x - normalX * sample.halfWidth, z: sample.z - normalZ * sample.halfWidth },
    right: { x: sample.x + normalX * sample.halfWidth, z: sample.z + normalZ * sample.halfWidth },
  };
});
const riverOutline = [...riverBanks.map(bank => bank.left), ...riverBanks.slice().reverse().map(bank => bank.right)];
const lakeOutlines = LAKES.map(lake => ({ ...lake, boundary: lakeBoundary(lake, 96) }));
const fishCenters = FISH_SCHOOLS.filter(school => school.points.length > 0).map(school => {
  const center = school.points.reduce((sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }), { x: 0, z: 0 });
  return { id: school.id, count: school.count, x: center.x / school.points.length, z: center.z / school.points.length };
});

// Stacked containers share their footprint. Keep one shape per footprint so
// following the drone does not redraw every level of every container stack.
function urbanFootprints(mapId: MapId) {
  const layout = getMapLayout(mapId);
  const containers = new Set<UrbanBox>(layout.containers);
  const warehouses = new Set<UrbanBox>(layout.warehouses);
  const piers = new Set<UrbanBox>(HARBOR_PIERS);
  const footprints = new Map<string, UrbanBox & { key: string; color: string }>();
  for (const box of layout.boxes) {
    const key = `${box.x}:${box.z}:${box.width}:${box.depth}:${box.yaw ?? 0}`;
    if (footprints.has(key)) continue;
    footprints.set(key, { ...box, key, color: piers.has(box) ? '#d5c6a0' : containers.has(box) ? '#b99b67' : warehouses.has(box) ? '#bdcdca' : '#9ca99b' });
  }
  return [...footprints.values()];
}
const mapFootprints = { valley: [], factory: urbanFootprints('factory'), harbor: urbanFootprints('harbor') };

function closedPath(points: MapPoint[]) {
  return points.length ? `M ${points.map(({ x, y }) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z` : '';
}

function stopMapInteraction(event: SyntheticEvent) {
  event.stopPropagation();
}

export default function Minimap({ telemetry, mode, mapId }: MinimapProps) {
  const selectedMap = getMapSpec(mapId);
  const worldBounds = selectedMap.bounds;
  const layout = getMapLayout(mapId);
  const isValley = mapId === 'valley';
  const [mapView, setMapView] = useState<MapView>(mode === 'race' ? 'route' : 'world');
  const [zoomIndex, setZoomIndex] = useState(0);
  const [cameraMode, setCameraMode] = useState<MapCameraMode>('overview');
  const [manualCenter, setManualCenter] = useState<MapPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<MapDrag | null>(null);
  const instanceId = useId();
  const clipId = `${instanceId}-map-clip`;
  const gridId = `${instanceId}-map-grid`;
  const panHelpId = `${instanceId}-map-pan-help`;
  const releaseDrag = (pointerId?: number) => {
    const gesture = drag.current;
    if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) return;
    drag.current = null; setDragging(false);
    if (gesture.element.hasPointerCapture(gesture.pointerId)) {
      try { gesture.element.releasePointerCapture(gesture.pointerId); } catch { /* Already released by the browser. */ }
    }
  };
  useEffect(() => {
    releaseDrag(); setMapView(mode === 'race' ? 'route' : 'world'); setZoomIndex(0);
    setCameraMode('overview'); setManualCenter(null);
  }, [mode, mapId]);
  useEffect(() => () => {
    const gesture = drag.current; drag.current = null;
    if (gesture?.element.hasPointerCapture(gesture.pointerId)) {
      try { gesture.element.releasePointerCapture(gesture.pointerId); } catch { /* Element may already be detached. */ }
    }
  }, []);

  const zoom = ZOOM_LEVELS[zoomIndex];
  const selectView = (view: MapView) => {
    releaseDrag(); setMapView(view); setZoomIndex(0); setManualCenter(null); setCameraMode('overview');
  };
  const followDrone = () => { releaseDrag(); setManualCenter(null); setCameraMode('follow'); };

  const bounds = getMapBounds(mapView, zoom, telemetry.position, worldBounds, {
    center: cameraMode === 'manual' ? manualCenter ?? undefined : undefined,
    follow: cameraMode === 'follow',
    routeBounds: selectedMap.routeBounds,
  });
  const center = getMapCenter(bounds);
  const canPan = bounds.maxX - bounds.minX < worldBounds.maxX - worldBounds.minX
    || bounds.maxZ - bounds.minZ < worldBounds.maxZ - worldBounds.minZ;
  const changeZoom = (direction: number) => {
    const nextIndex = clamp(zoomIndex + direction, 0, ZOOM_LEVELS.length - 1);
    if (nextIndex === zoomIndex) return;
    releaseDrag();
    if (cameraMode === 'manual') {
      const nextBounds = getMapBounds(mapView, ZOOM_LEVELS[nextIndex], telemetry.position, worldBounds, { center, follow: false, routeBounds: selectedMap.routeBounds });
      setManualCenter(getMapCenter(nextBounds));
    } else setCameraMode('follow');
    setZoomIndex(nextIndex);
  };
  const startPan = (event: PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (!canPan || !event.isPrimary || event.button !== 0 || drag.current) return;
    const element = event.currentTarget; const rectangle = element.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return;
    try { element.setPointerCapture(event.pointerId); } catch { return; }
    event.preventDefault(); element.focus({ preventScroll: true });
    drag.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      bounds, viewport: { width: rectangle.width, height: rectangle.height }, element, moved: false,
    };
  };
  const movePan = (event: PointerEvent<SVGSVGElement>) => {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.buttons === 0) { releaseDrag(event.pointerId); return; }
    if (!gesture.moved) {
      const beginning = beginMapDrag(bounds, { x: gesture.startX, y: gesture.startY }, { x: event.clientX, y: event.clientY });
      if (!beginning) return;
      gesture.bounds = beginning.bounds;
      gesture.startX = beginning.start.x; gesture.startY = beginning.start.y;
    }
    const dx = event.clientX - gesture.startX; const dy = event.clientY - gesture.startY;
    gesture.moved = true; event.preventDefault(); setDragging(true);
    const nextBounds = panMapBounds(gesture.bounds, dx, dy, gesture.viewport, worldBounds);
    setManualCenter(getMapCenter(nextBounds)); setCameraMode('manual');
  };
  const finishPan = (event: PointerEvent<SVGSVGElement>) => { event.stopPropagation(); releaseDrag(event.pointerId); };
  const keyboardPan = (event: KeyboardEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? 0.25 : 0.12;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dz = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx || dz) {
      event.preventDefault();
      if (!canPan) return;
      releaseDrag();
      const next = centerMapBounds(bounds, { x: center.x + dx * (bounds.maxX - bounds.minX), z: center.z + dz * (bounds.maxZ - bounds.minZ) }, worldBounds);
      setManualCenter(getMapCenter(next)); setCameraMode('manual');
    } else if (event.key === 'Home') { event.preventDefault(); followDrone(); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1); }
    else if (event.key === '-') { event.preventDefault(); changeZoom(-1); }
    else if (event.key === ' ') event.preventDefault();
  };
  const geography = useMemo(() => {
    const projection = createProjection(bounds);
    const riverLabel = RIVER_SAMPLES[Math.floor(RIVER_SAMPLES.length / 2)];
    return {
      ...projection,
      riverPath: isValley ? closedPath(riverOutline.map(point => projection.project(point.x, point.z))) : '',
      riverLabel: isValley && riverLabel ? projection.project(riverLabel.x, riverLabel.z) : null,
      lakes: (isValley ? lakeOutlines : []).map(lake => ({
        id: lake.id,
        name: lake.name,
        position: projection.project(lake.x, lake.z),
        path: closedPath(lake.boundary.map(point => projection.project(point.x, point.z))),
      })),
      fishSchools: (isValley ? fishCenters : []).map(school => ({ ...school, position: projection.project(school.x, school.z) })),
      urbanBoxes: mapFootprints[mapId].filter(box => {
        const radius = Math.hypot(box.width, box.depth) / 2;
        return box.x + radius >= bounds.minX && box.x - radius <= bounds.maxX && box.z + radius >= bounds.minZ && box.z - radius <= bounds.maxZ;
      }).map(box => ({ ...box, position: projection.project(box.x, box.z), width: box.width * projection.scale, depth: box.depth * projection.scale })),
      landmarks: layout.landmarks.map(landmark => ({ ...landmark, position: projection.project(landmark.x, landmark.z) })),
      shore: projection.project(HARBOR_SHORE_X, worldBounds.minZ),
      seaCorner: projection.project(worldBounds.maxX, worldBounds.maxZ),
      ship: layout.ship ? { ...layout.ship, position: projection.project(layout.ship.x, layout.ship.z), width: layout.ship.width * projection.scale, length: layout.ship.length * projection.scale } : null,
    };
  }, [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, mapId, isValley, layout, worldBounds]);

  const points = selectedMap.checkpoints.map(({ position }) => geography.project(position.x, position.z));
  const start = geography.project(selectedMap.spawn.x, selectedMap.spawn.z);
  const outsideView = isOutsideBounds(telemetry.position, bounds);
  const drone = geography.project(telemetry.position.x, telemetry.position.z);
  const target = selectedMap.checkpoints[telemetry.checkpoint];
  const distance = target ? Math.round(Math.hypot(
    target.position.x - telemetry.position.x,
    target.position.y - telemetry.position.y,
    target.position.z - telemetry.position.z,
  )) : 0;
  const course = [start, ...points].map(({ x, y }) => `${x},${y}`).join(' ');
  const isWorld = mapView === 'world';
  const compactSymbols = isWorld && zoom <= 2;
  const followLabel = cameraMode === 'manual' || outsideView ? '回到无人机' : cameraMode === 'follow' ? '跟随中' : '跟随';
  const { wind } = telemetry;
  const calm = wind.speed < 0.1;
  const windLabel = calm ? '无风' : `${wind.directionLabel}风`;
  const geographyLabel = isValley ? '蓝色为河流湖泊，浅蓝鱼形标记为鱼群，米色为小屋和桥'
    : mapId === 'factory' ? '灰色为厂房和工业设施，金色为堆箱，圆点为厂房和储罐地标'
      : '蓝色为海面，米色为码头，灰色为仓库和货轮，金色为堆箱，圆点为桥吊和灯塔地标';

  return (
    <div className={`minimap geographic-minimap${isWorld ? ' minimap-world' : ''}`} aria-label={`${selectedMap.name}小地图，${isValley ? '河流、湖泊、小屋、小桥、鱼群' : mapId === 'factory' ? '厂房、储罐、烟囱、堆箱' : '海岸、码头、仓库、堆箱、桥吊、货轮'}、当前位置、检查点与投弹靶标`} data-map-mode={cameraMode} data-map-id={mapId}
      onClick={stopMapInteraction} onDoubleClick={stopMapInteraction} onPointerDown={stopMapInteraction} onKeyDown={stopMapInteraction}>
      <div className={`minimap-wind${calm ? ' is-calm' : ''}`} role="img"
        aria-label={`风向：${windLabel}，${wind.speed.toFixed(1)} 米每秒${calm ? '' : '；箭头表示风吹向，地图上方为北'}`}>
        <span className="minimap-wind-caption">{calm ? '风向' : '风吹向'}</span>
        <div className="minimap-wind-compass" aria-hidden="true">
          <span>N</span>
          {calm ? <i className="minimap-wind-calm" /> : <svg className="minimap-wind-arrow" viewBox="0 0 24 24"
            style={{ transform: `rotate(${wind.fromDegrees}deg)` }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v16M6 14l6 6 6-6" />
          </svg>}
        </div>
        <strong>{windLabel}</strong>
      </div>
      <div className="map-heading">
        <div className="minimap-heading-controls">
          <div className="minimap-modes" role="group" aria-label="地图范围">
            <button type="button" aria-pressed={isWorld} onClick={() => selectView('world')} title="恢复全域总览，1 倍">全域</button>
            <button type="button" aria-pressed={!isWorld} onClick={() => selectView('route')} title="恢复航线总览，1 倍">航线</button>
          </div>
          <button className="minimap-follow" type="button" aria-pressed={cameraMode === 'follow'}
            onClick={followDrone} aria-label="回到无人机并自动跟随" title={cameraMode === 'follow' ? '正在跟随无人机；拖动可自由浏览' : '回到无人机并自动跟随'}>
            <span className="minimap-follow-full">{followLabel}</span><span className="minimap-follow-short">跟随</span>
          </button>
        </div>
        <span>N ↑</span>
      </div>
      <svg className={`minimap-pan-surface${canPan ? ' can-pan' : ''}${dragging ? ' is-dragging' : ''}`} viewBox="0 0 180 150" role="img" tabIndex={0}
        aria-describedby={panHelpId} aria-label={`${selectedMap.name}${isWorld ? '全域地图' : '航线地图'}，${zoom} 倍，${cameraMode === 'follow' ? '跟随无人机' : cameraMode === 'manual' ? '自由浏览' : '预设总览'}，${geographyLabel}，橙色为未命中靶标${outsideView ? '；无人机在当前视窗外，点击回到无人机查看' : ''}`}
        data-map-center-x={center.x} data-map-center-z={center.z}
        onPointerDown={startPan} onPointerMove={movePan} onPointerUp={finishPan} onPointerCancel={finishPan} onLostPointerCapture={finishPan} onKeyDown={keyboardPan}>
        <title>{canPan ? '拖动或使用方向键浏览；Home 回到无人机' : '全域已完整显示，放大后可拖动浏览'}</title>
        <defs>
          <pattern id={gridId} width="30" height="25" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 25" fill="none" stroke="currentColor" strokeOpacity="0.09" strokeWidth="0.6" />
          </pattern>
          <clipPath id={clipId}>
            <rect x={geography.left} y={geography.top} width={geography.width} height={geography.height} rx="3" />
          </clipPath>
        </defs>
        <rect x={geography.left} y={geography.top} width={geography.width} height={geography.height} rx="3" fill={isValley ? '#273e2d' : '#35413c'} fillOpacity="0.65" stroke="#a5b89a" strokeOpacity="0.16" strokeWidth="0.6" />
        <g clipPath={`url(#${clipId})`}>
          <rect width="180" height="150" fill={`url(#${gridId})`} />
          {!isValley && <>
            {mapId === 'harbor' && <rect x={geography.shore.x} y={geography.shore.y} width={geography.seaCorner.x - geography.shore.x} height={geography.seaCorner.y - geography.shore.y} fill="#6094a8" fillOpacity="0.72"><title>海岸与港口水区</title></rect>}
            {geography.urbanBoxes.map(box => <rect key={box.key} x={-box.width / 2} y={-box.depth / 2} width={box.width} height={box.depth}
              transform={`translate(${box.position.x} ${box.position.y}) rotate(${-(box.yaw ?? 0) * 180 / Math.PI})`} fill={box.color} fillOpacity="0.72" stroke="#202f2a" strokeWidth="0.25" />)}
            {geography.ship && <g transform={`translate(${geography.ship.position.x} ${geography.ship.position.y})`}>
              <title>货轮 MERIDIAN</title>
              <path d={`M 0 ${-geography.ship.length / 2} L ${geography.ship.width / 2} ${-geography.ship.length / 2 + geography.ship.width / 2} L ${geography.ship.width / 2} ${geography.ship.length / 2} L ${-geography.ship.width / 2} ${geography.ship.length / 2} L ${-geography.ship.width / 2} ${-geography.ship.length / 2 + geography.ship.width / 2} Z`} fill="none" stroke="#dae5df" strokeWidth="0.85" />
            </g>}
            {geography.landmarks.map((landmark, index) => <g key={`${landmark.kind}-${index}`} transform={`translate(${landmark.position.x} ${landmark.position.y})`}>
              <title>{landmark.label}</title>
              {landmark.kind === 'crane' ? <path d="M -3 3 L -3 -3 L 4 -3 M 2 -3 L 2 2 M -4 3 L 4 3" fill="none" stroke="#e8daaa" strokeWidth={compactSymbols ? 0.6 : 1} /> : <circle r={compactSymbols ? 1 : 2} fill={landmark.kind === 'lighthouse' ? '#dff781' : '#e1ddbe'} stroke="#26372d" strokeWidth="0.5" />}
              {!compactSymbols && zoom > 1 && <text x="5" y="2" fontSize="6" fill="#f1f4e9">{landmark.label}</text>}
            </g>)}
          </>}
          {isValley && <>
          <path d={geography.riverPath} fill="#6094a8" fillOpacity="0.7" stroke="#93c4d0" strokeOpacity="0.55" strokeWidth="0.65"><title>河流</title></path>
          {geography.lakes.map(lake => <path key={lake.id} d={lake.path} fill="#6094a8" fillOpacity="0.78" stroke="#93c4d0" strokeOpacity="0.65" strokeWidth="0.65"><title>{lake.name}</title></path>)}
          {isWorld && <g className="minimap-water-labels" fontSize="6.5" fill="#e3f3f5" textAnchor="middle">
            {geography.lakes.map(lake => <text key={lake.id} x={lake.position.x} y={lake.position.y + 2}>{lake.name}</text>)}
            {geography.riverLabel && <text x={geography.riverLabel.x - 6} y={geography.riverLabel.y} textAnchor="end">河流</text>}
          </g>}
          {CABINS.map(cabin => {
            const point = geography.project(cabin.x, cabin.z);
            return <g key={cabin.id} transform={`translate(${point.x} ${point.y}) scale(${compactSymbols ? 0.45 : 0.7})`}>
              <title>{cabin.name}，乡间小屋</title>
              <path d="M -5 0 L 0 -4 L 5 0 L 5 5 L -5 5 Z" fill="#dcca9b" stroke="#243329" strokeWidth="1" />
              <path d="M -1 5 L -1 2 L 1 2 L 1 5" fill="#3c4631" />
            </g>;
          })}
          {BRIDGES.map(bridge => {
            const point = geography.project(bridge.x, bridge.z);
            return <g key={bridge.id} transform={`translate(${point.x} ${point.y}) rotate(${-bridge.yaw * 180 / Math.PI}) scale(${compactSymbols ? 0.55 : 0.85})`}>
              <title>{bridge.name}，跨河小桥</title>
              <path d="M -6 -2 L 6 -2 L 6 2 L -6 2 Z" fill="#dcca9b" stroke="#243329" strokeWidth="1" />
              <path d="M -4 -4 L -4 4 M 4 -4 L 4 4" stroke="#eddfb8" strokeWidth="1.2" />
            </g>;
          })}
          {geography.fishSchools.map(school => <g key={school.id}
            transform={`translate(${school.position.x} ${school.position.y}) scale(${compactSymbols ? 0.65 : 0.85})`}
            role="img" aria-label={`鱼群，${school.count} 条，低空悬停并切换俯视观察`}>
            <title>鱼群，{school.count} 条。靠近鱼标后低空悬停，按 V 切换俯视观察。</title>
            <path d="M -4 0 C -1 -4 3 -4 6 0 C 3 4 -1 4 -4 0 L -7 -3 L -7 3 Z" fill="#b7eefa" stroke="#213e38" strokeWidth="0.8" strokeLinejoin="round" />
            <circle cx="3" cy="-0.6" r="0.6" fill="#213e38" />
          </g>)}
          </>}
          <polyline points={course} fill="none" stroke="currentColor" strokeOpacity={compactSymbols ? 0.45 : 0.55} strokeWidth={compactSymbols ? 0.8 : 1.3} strokeDasharray={compactSymbols ? '2 2' : '3 4'} />
          {points.map((point, index) => {
            const passed = mode === 'race' && index < telemetry.checkpoint;
            const active = mode === 'race' && index === telemetry.checkpoint;
            return <g key={index}>
              {active && <circle cx={point.x} cy={point.y} r={compactSymbols ? 4 : 8} fill="none" stroke="#c8ff5f" strokeOpacity="0.35" strokeWidth="1" />}
              <circle cx={point.x} cy={point.y} r={compactSymbols ? active ? 2.2 : 1.3 : active ? 4.4 : 3}
                fill={active ? '#17221b' : passed ? '#c8ff5f' : '#f1f6f2'} fillOpacity={passed || active ? 1 : 0.65}
                stroke={passed || active ? '#c8ff5f' : '#f1f6f2'} strokeWidth={active ? compactSymbols ? 0.9 : 1.8 : 0.6}>
                <title>检查点 {index + 1}{passed ? '，已通过' : active ? '，下一个目标' : ''}</title>
              </circle>
              {!compactSymbols && <text x={point.x + 7} y={point.y + 3} fontSize="8" fill="currentColor" fillOpacity={active ? 1 : 0.5}>{index + 1}</text>}
            </g>;
          })}
          {selectedMap.targets.map(target => {
            const point = geography.project(target.position.x, target.position.z);
            const hit = telemetry.weapons.hitTargetIds.includes(target.id);
            const radius = compactSymbols ? 2.4 : 6;
            return <g key={target.id} transform={`translate(${point.x} ${point.y})`}>
              <title>{hit ? '已命中靶标' : '投弹靶标'}</title>
              <path d={`M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`} fill={hit ? '#dff781' : '#ec9b60'} fillOpacity={hit ? 0.45 : 0.9} stroke="#243329" strokeWidth={compactSymbols ? 0.5 : 1} />
            </g>;
          })}
        </g>
        {!outsideView && <g transform={`translate(${drone.x} ${drone.y}) rotate(${-telemetry.yaw * 180 / Math.PI})`}>
          <title>无人机当前位置</title>
          <circle r="9" fill="#c8ff5f" fillOpacity="0.12" />
          <path d="M 0 -7 L 5 5 L 0 3 L -5 5 Z" fill="#c8ff5f" stroke="#17221b" strokeWidth="1" />
        </g>}
        {outsideView && <text x="90" y="147" textAnchor="middle" fontSize="7" fill="#e5dcae">无人机在视窗外</text>}
      </svg>
      <span id={panHelpId} className="minimap-pan-help">{canPan ? '拖动地图或使用方向键平移；拖动后暂停跟随，Home 或跟随按钮回到无人机。' : '全域已完整显示，点击加号放大后可拖动。'}加减键缩放，点击倍率或预设恢复总览。</span>
      <div className="minimap-zoom" role="group" aria-label="地图缩放">
        <button type="button" disabled={zoomIndex === 0} onClick={() => changeZoom(-1)}
          aria-label="缩小地图" title="缩小地图">−</button>
        <button type="button" className="minimap-zoom-factor" onClick={() => selectView(mapView)}
          aria-label={`当前 ${zoom} 倍，点击恢复 1 倍总览`} title="恢复 1× 总览">
          <span aria-live="polite" aria-atomic="true">{zoom}×</span>
        </button>
        <button type="button" disabled={zoomIndex === ZOOM_LEVELS.length - 1} onClick={() => changeZoom(1)}
          aria-label="放大地图" title="放大地图">+</button>
      </div>
      <div className="map-distance">
        <span>{outsideView ? '视窗外' : mode === 'free' ? cameraMode === 'manual' ? '浏览范围' : zoom > 1 ? '跟随范围' : '探索范围' : target ? '下个检查点' : '航线完成'}</span>
        <strong>{mode === 'race' && target ? `${distance} m` : mode === 'race' ? `${selectedMap.checkpoints.length} / ${selectedMap.checkpoints.length}` : formatMapSpan(bounds)}</strong>
      </div>
      <div className="map-discovery" aria-label={isValley ? '浅蓝鱼形标记是鱼群，沿河飞到木桥下游，低空悬停，按 V 或手机视角按钮切换俯视观察' : `${selectedMap.name}地标，${mapId === 'factory' ? '厂房、储罐、烟囱和堆箱' : '码头、桥吊、堆箱、货轮和灯塔'}；放大地图查看位置，按 V 切换俯视观察`}>
        <svg viewBox="-8 -4 15 8" aria-hidden="true">{isValley ? <path d="M -4 0 C -1 -4 3 -4 6 0 C 3 4 -1 4 -4 0 L -7 -3 L -7 3 Z" fill="currentColor" /> : <path d="M -6 3 L -6 -1 L -2 -3 L -2 -1 L 2 -3 L 2 3 Z M 3 3 L 3 -4 L 5 -4 L 5 3 Z" fill="currentColor" />}</svg>
        <span>{isValley ? '鱼群 · V 俯视' : mapId === 'factory' ? '厂房 · 储罐 · 烟囱' : '码头 · 桥吊 · 货轮'}</span>
      </div>
    </div>
  );
}
