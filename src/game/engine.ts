import * as THREE from 'three';
import type { NoticeMessage } from '../i18n/locale';
import { createFlightState, crossesCheckpoint } from './flight';
import { createWorld } from './world';
import { WATER_LEVEL } from './landscape';
import { DEFAULT_MAP_ID, MAPS, getMapSpec } from './map-catalog';
import type { MapId, MapSpec } from './map-catalog';
import { FlightAudio } from './audio';
import { createDrone } from './drone';
import { DEFAULT_DRONE_ID, DRONES, getDroneSpec } from './drone-catalog';
import type { DroneId } from './drone-catalog';
import type { WeaponState } from './weapons';
import { createWeaponSimulation } from './weapon-simulation';
import type { WeaponSimulation } from './weapon-simulation';
import { createRustRuntime } from './rust-runtime';
import type { RustRuntime } from './rust-runtime';
import { createWorldKernel } from './world-kernel';
import type { WorldKernel } from './world-kernel';
import { createWeaponVisuals } from './weapon-visuals';
import type { RaceMode, FlightMode, CameraMode, Status, Telemetry } from './types';
import { EMPTY_TELEMETRY } from './types';
import { DEFAULT_WIND_SETTINGS } from './wind';
import type { WindSettings } from './wind';
import { createWorldFlightSimulation } from './flight-simulation';
import type { FlightSimulation } from './flight-simulation';
import { createMapCache } from './map-cache';
import type { MapLoadProgress } from './map-cache';
import { abortableResource } from './asset-cache';
import { preloadWorldAssets } from './world-assets';
import type { WorldAssets } from './world-assets';
import { createLoadingMetrics } from './loading-metrics';
import type { LoadingMetrics } from './loading-metrics';
import { FixedSimulationClock } from './simulation-clock';
import { RenderPerformanceMonitor } from './render-performance';

export interface EngineEvents {
  telemetry: (value: Telemetry) => void;
  status: (value: Status) => void;
  notice: (value: NoticeMessage) => void;
  finish: (seconds: number) => void;
  cameraMode: (value: CameraMode) => void;
}

interface MapResources {
  spec: MapSpec;
  world: ReturnType<typeof createWorld>;
  kernel: WorldKernel;
  simulation: FlightSimulation;
  weapons: WeaponSimulation;
  visuals: ReturnType<typeof createWeaponVisuals>;
  dispose(): void;
}

export class FlightEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly audio = new FlightAudio();
  private readonly runtime: RustRuntime;
  private readonly maps: ReturnType<typeof createMapCache<MapId, MapResources>>;
  private activeMap: MapResources;
  private prepared = false;
  private preparing: Promise<void> | null = null;
  private compilation: Promise<THREE.Object3D> | null = null;
  private readonly warmupTarget = new THREE.WebGLRenderTarget(256, 144);
  private readonly panoramaResolution: 3548 | 7096;
  private night = false;
  private get world() { return this.activeMap.world; }
  private get worldKernel() { return this.activeMap.kernel; }
  private get mapSpec() { return this.activeMap.spec; }
  private get weaponSimulation() { return this.activeMap.weapons; }
  private get weaponVisuals() { return this.activeMap.visuals; }
  private get simulation() { return this.activeMap.simulation; }
  get mapId(): MapId { return this.activeMap.spec.id; }
  private camera = new THREE.PerspectiveCamera(68, 1, 0.2, 10000);
  private drone = createDrone();
  private selectedDroneId: DroneId = DEFAULT_DRONE_ID;
  private disposed = false;
  private headlight = new THREE.SpotLight('#dcecff', 0, 85, Math.PI / 5, 0.55, 1.5);
  private headlightTarget = new THREE.Object3D();
  private weapons: WeaponState;
  private previousWeapons: WeaponState;
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private snapCamera = true;
  private state = createFlightState();
  private previousPose = createFlightState();
  private displayPose = createFlightState();
  private readonly simulationClock = new FixedSimulationClock();
  private readonly renderPerformance = new RenderPerformanceMonitor({
    devicePixelRatio: window.devicePixelRatio, isMobile: matchMedia('(pointer: coarse)').matches,
  });
  private status: Status = 'ready';
  private keys = new Set<string>();
  private frame = 0;
  private lastTime = 0;
  private lastEmit = 0;
  private lastPerformanceMetrics: unknown;
  private elapsed = 0;
  private windClock = 0;
  private wind: Telemetry['wind'] = EMPTY_TELEMETRY.wind;
  private currentWind: WindSettings = { ...DEFAULT_WIND_SETTINGS };
  private unchangedWind = true;
  private checkpoint = 0;
  private collisionCooldown = 0;
  private resizeObserver: ResizeObserver;
  private touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
  mode: RaceMode = 'race';
  flightMode: FlightMode = 'assisted';
  cameraMode: CameraMode = 'chase';
  get droneId(): DroneId { return this.selectedDroneId; }
  get windSettings(): Readonly<WindSettings> { return this.currentWind; }
  get recordEligible(): boolean { return this.unchangedWind; }

  /** Start the selected images before WASM/CPU work, sharing the actual renderer and decoded Images. */
  static async create(host: HTMLDivElement, events: EngineEvents, flightCore: Promise<WebAssembly.Module>,
    mapId: MapId = DEFAULT_MAP_ID, signal: AbortSignal = new AbortController().signal,
    startedAt = performance.now()): Promise<FlightEngine> {
    // The shared module may reject even if WebGL fails before its await is reached.
    void flightCore.catch(() => {});
    const metrics = createLoadingMetrics(startedAt);
    const stopRenderer = metrics.measure('renderer');
    let renderer: THREE.WebGLRenderer | undefined;
    let assets: WorldAssets | undefined;
    try {
      if (signal.aborted) throw new DOMException('Loading cancelled', 'AbortError');
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      const resolution = host.getBoundingClientRect().width * renderer.getPixelRatio() > 900
        && renderer.capabilities.maxTextureSize >= 7096 ? 7096 : 3548;
      stopRenderer();
      const stopTextures = metrics.measure('textures');
      assets = preloadWorldAssets(resolution);
      void assets.ready.then(stopTextures, () => {});
      let core: WebAssembly.Module;
      try { core = await abortableResource(flightCore, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        throw new Error('飞行模块加载失败。请刷新页面，并使用支持 WebAssembly 的新版浏览器。', { cause: error });
      }
      metrics.record('wasm', startedAt);
      if (signal.aborted) throw new DOMException('Loading cancelled', 'AbortError');
      return new FlightEngine(host, events, core, mapId, renderer, assets, metrics, resolution);
    } catch (error) {
      assets?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
      throw error;
    }
  }

  private constructor(private host: HTMLDivElement, private events: EngineEvents, flightCore: WebAssembly.Module,
    mapId: MapId, renderer: THREE.WebGLRenderer, private assets: WorldAssets,
    private loadingMetrics: LoadingMetrics, resolution: 3548 | 7096) {
    this.renderer = renderer;
    this.renderer.setPixelRatio(this.renderPerformance.pixelRatio);
    this.panoramaResolution = resolution;
    let maps: FlightEngine['maps'] | undefined;
    try {
      this.runtime = createRustRuntime(flightCore);
      this.maps = maps = createMapCache(MAPS.map(map => map.id), id => this.createMap(id), map => this.prepareMap(map), {
        // Build the urban CPU scenes while the valley's larger images download/decode.
        beforeCreate: () => new Promise(resolve => requestAnimationFrame(() => resolve())),
        waitUntilReady: map => map.world.ready,
      });
      this.activeMap = this.maps.getOrCreate(mapId);
      this.state = this.initialState();
      this.weapons = this.weaponSimulation.state;
      this.previousWeapons = this.weapons;
    } catch (error) {
      maps?.dispose(); this.drone.dispose(); this.headlight.dispose(); this.audio.dispose();
      this.warmupTarget.dispose();
      throw error;
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', `三维${this.mapSpec.name}飞行画面，飞行时点击可启用鼠标视角`);
    this.renderer.domElement.dataset.flightCore = 'rust-wasm';
    this.renderer.domElement.dataset.numericServices = 'world,weapons,scene,particles,ecology';
    this.renderer.domElement.dataset.textureResolution = mapId === 'valley' ? String(this.panoramaResolution) : 'procedural';
    this.renderer.domElement.dataset.mapId = mapId;
    this.renderer.domElement.dataset.preloadedMaps = '';
    this.renderer.domElement.tabIndex = 0;
    host.appendChild(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ';
    this.drone.model.rotation.order = 'YXZ';
    this.world.scene.add(this.drone.model, this.weaponVisuals.group);
    this.headlight.position.set(0, -0.1, -0.75);
    this.headlightTarget.position.set(0, -5, -17);
    this.headlight.target = this.headlightTarget;
    // Keep lights outside the hidden FPV model, so first-person flight is illuminated too.
    this.world.scene.add(this.headlight, this.headlightTarget);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('mousemove', this.mousemove);
    document.addEventListener('pointerlockchange', this.pointerlockchange);
    this.renderer.domElement.addEventListener('click', this.lockPointer);
    this.copyPreviousPose(); this.refreshWind(); this.resize();
  }
  private createMap(id: MapId): MapResources {
    const stopCpu = this.loadingMetrics.measure(`${id}.cpu`);
    const spec = getMapSpec(id);
    let kernel: WorldKernel | undefined;
    let world: ReturnType<typeof createWorld> | undefined;
    let simulation: FlightSimulation | undefined;
    let weapons: WeaponSimulation | undefined;
    let visuals: ReturnType<typeof createWeaponVisuals> | undefined;
    try {
      kernel = createWorldKernel(this.runtime, id);
      world = createWorld(this.runtime, kernel, {
        resolution: this.panoramaResolution,
        maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
        assets: this.assets,
      }, id);
      kernel.setObstacles(world.obstacles);
      simulation = createWorldFlightSimulation(this.runtime, kernel.handle);
      weapons = createWeaponSimulation(this.runtime, kernel, spec.targets);
      visuals = createWeaponVisuals(this.runtime, kernel, spec.targets);
      world.scene.add(visuals.group);
      world.setNight(this.night); visuals.setNight(this.night);
      stopCpu();
      let disposed = false;
      return { spec, kernel, world, simulation, weapons, visuals, dispose() {
        if (disposed) return;
        disposed = true;
        simulation!.dispose(); weapons!.dispose(); visuals!.dispose(); world!.dispose(); kernel!.dispose();
      } };
    } catch (error) {
      simulation?.dispose(); weapons?.dispose(); visuals?.dispose(); world?.dispose(); kernel?.dispose();
      throw error;
    }
  }
  private attachAircraft(map: MapResources) {
    map.world.scene.add(this.drone.model, this.headlight, this.headlightTarget);
  }
  private async prepareMap(map: MapResources) {
    // Let React paint the progress before CPU scene preparation and GPU work.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (this.disposed) throw new Error('Flight engine has been disposed');
    const stopGpu = this.loadingMetrics.measure(`${map.spec.id}.gpu`);
    this.attachAircraft(map);
    const { spawn, spawnYaw } = map.spec;
    this.drone.model.position.set(spawn.x, spawn.y, spawn.z);
    this.camera.position.set(spawn.x + Math.sin(spawnYaw) * 8, spawn.y + 3.3, spawn.z + Math.cos(spawnYaw) * 8);
    this.camera.lookAt(spawn.x - Math.sin(spawnYaw) * 5, spawn.y + 0.8, spawn.z - Math.cos(spawnYaw) * 5);
    map.world.update(0, 0, spawn, this.camera.position);
    map.visuals.update(map.weapons.state, 0);
    // Both lighting states are warmed, including their initially hidden sky/effects materials.
    for (const night of [false, true]) {
      map.world.setNight(night); map.visuals.setNight(night);
      this.headlight.intensity = night ? 950 : 0;
      const stopCompile = this.loadingMetrics.measure(`${map.spec.id}.${night ? 'night' : 'day'}.compile`);
      const compiling = this.renderer.compileAsync(map.world.scene, this.camera);
      this.compilation = compiling;
      try { await compiling; } finally { if (this.compilation === compiling) this.compilation = null; }
      stopCompile();
      if (this.disposed) throw new Error('Flight engine has been disposed');
      const previousTarget = this.renderer.getRenderTarget();
      const stopUpload = this.loadingMetrics.measure(`${map.spec.id}.${night ? 'night' : 'day'}.upload`);
      try {
        // The render also uploads visible geometry, decoded textures and shadow maps.
        this.renderer.setRenderTarget(this.warmupTarget);
        this.renderer.render(map.world.scene, this.camera);
      } finally { this.renderer.setRenderTarget(previousTarget); }
      stopUpload();
    }
    map.world.setNight(this.night); map.visuals.setNight(this.night);
    this.headlight.intensity = this.night ? 950 : 0;
    this.attachAircraft(this.activeMap);
    stopGpu();
  }
  preloadMaps(onProgress: (progress: MapLoadProgress<MapId>) => void = () => {}) {
    this.preparing ??= (async () => {
      await this.maps.preload(progress => {
        this.renderer.domElement.dataset.preloadedMaps = progress.ready.join(',');
        onProgress(progress);
      });
      if (this.disposed) throw new Error('Flight engine has been disposed');
      this.prepared = true; this.snapCamera = true;
      this.setNight(this.night);
      this.attachAircraft(this.activeMap);
      this.tick(performance.now());
      // Measured through the first visible frame, the same point at which App enables flight.
      const measurements = this.loadingMetrics.snapshot();
      this.renderer.domElement.dataset.loadingMetrics = JSON.stringify(measurements);
      this.renderer.domElement.dataset.initializationMs = String(measurements.total);
    })();
    return this.preparing;
  }
  /** Selects an already prepared scene without rebuilding WebGL or its Rust services. */
  setMap(id: MapId): boolean {
    if (this.disposed || !this.prepared) return false;
    if (id === this.mapId) return true;
    this.activeMap = this.maps.getReady(id);
    this.attachAircraft(this.activeMap);
    this.renderer.domElement.dataset.mapId = id;
    this.renderer.domElement.dataset.textureResolution = id === 'valley' ? String(this.panoramaResolution) : 'procedural';
    this.renderer.domElement.setAttribute('aria-label', `三维${this.mapSpec.name}飞行画面，飞行时点击可启用鼠标视角`);
    this.reset();
    this.weaponVisuals.update(this.weapons, 0);
    return true;
  }
  /** Accessibility text changes independently of the scene and numerical simulation. */
  setAccessibleLabel(label: string) { this.renderer.domElement.setAttribute('aria-label', label); }
  private initialState() {
    const state = createFlightState();
    state.position = { ...this.mapSpec.spawn };
    state.yaw = this.mapSpec.spawnYaw;
    return state;
  }
  private resize = () => {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1));
    this.camera.aspect = width / Math.max(height, 1); this.camera.updateProjectionMatrix();
  };
  private keydown = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || target?.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]')
      || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyV') {
      event.preventDefault(); if (!event.repeat) this.cycleCameraMode(); return;
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault(); if (!event.repeat) { if (event.code === 'Escape') this.pause(); else this.togglePause(); } return;
    }
    if (event.code === 'KeyR' && !event.repeat && this.status !== 'ready') { event.preventDefault(); this.start(); return; }
    if (this.status !== 'flying') return;
    if (event.code === 'KeyB') { event.preventDefault(); if (!event.repeat) this.dropBomb(); return; }
    if (['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','Space','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) {
      event.preventDefault(); this.keys.add(event.code);
    }
  };
  private keyup = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private blur = () => { this.keys.clear(); this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 }; if (this.status === 'flying') this.pause(); };
  private visibility = () => { if (document.hidden) this.blur(); };
  private lockPointer = () => {
    if (this.status === 'flying' && matchMedia('(pointer: fine)').matches) {
      void this.renderer.domElement.requestPointerLock()?.catch(() => this.events.notice('鼠标视角暂不可用，可继续使用键盘飞行'));
    }
  };
  private pointerlockchange = () => { if (!document.pointerLockElement && this.status === 'flying') this.pause(); };
  private mousemove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement || this.status !== 'flying') return;
    this.state.yaw -= event.movementX * 0.0025 * getDroneSpec(this.selectedDroneId).flight.yaw;
    this.state.pitch = THREE.MathUtils.clamp(this.state.pitch - event.movementY * 0.0025, -0.7, 0.7);
  };
  setNight(enabled: boolean) {
    if (this.disposed) return;
    this.night = enabled;
    // Changes during async compilation must not mutate the lighting state being warmed.
    if (!this.prepared) return;
    this.maps.forEach(map => { map.world.setNight(enabled); map.visuals.setNight(enabled); });
    this.headlight.intensity = enabled ? 950 : 0;
    this.renderer.toneMappingExposure = enabled ? 1.05 : 1.2;
  }
  setWind(settings: WindSettings) {
    if (this.disposed) return;
    const direction = Number.isFinite(settings.direction) ? ((settings.direction % 360) + 360) % 360 : 315;
    const strength = ['calm', 'breeze', 'windy', 'strong'].includes(settings.strength) ? settings.strength : 'breeze';
    const changed = strength !== this.currentWind.strength || (strength !== 'calm' && direction !== this.currentWind.direction);
    if (changed && (this.status === 'flying' || this.status === 'paused')) this.unchangedWind = false;
    this.currentWind = { strength, direction };
    this.refreshWind();
    this.emit();
  }
  /** A model can be changed only outside an active or paused flight. */
  setDrone(id: DroneId): boolean {
    if (this.disposed || (this.status !== 'ready' && this.status !== 'finished') || !DRONES.some(spec => spec.id === id)) return false;
    if (id !== this.selectedDroneId) {
      const next = createDrone(id);
      next.model.rotation.order = 'YXZ';
      this.drone.dispose(); this.drone = next; this.selectedDroneId = id;
      this.world.scene.add(next.model);
    }
    this.reset();
    this.events.notice({ key: '已选择 {name} · 参考参数可在机库查看', params: { name: getDroneSpec(id).name } });
    return true;
  }
  setTouch(axis: keyof typeof this.touch, value: number) { this.touch[axis] = value; }
  setCameraMode(mode: CameraMode) {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode; this.snapCamera = true; this.events.cameraMode(mode);
  }
  cycleCameraMode() { this.setCameraMode(this.cameraMode === 'chase' ? 'bomb' : this.cameraMode === 'bomb' ? 'fpv' : 'chase'); }
  dropBomb() {
    if (this.status !== 'flying') return;
    if (this.weaponSimulation.drop(this.state.position, this.state.velocity)) {
      this.weapons = this.weaponSimulation.state;
      this.audio.drop(); this.emit();
      if (this.weapons.ammo === 0) this.events.notice('弹药已投完 · 3 秒后自动补充');
    }
  }
  private setStatus(status: Status) {
    if (status !== this.status) {
      if (status === 'flying') this.simulationClock.reset(performance.now());
      this.renderPerformance.reset();
      this.copyPreviousPose();
    }
    this.status = status; this.events.status(status);
  }
  start() {
    if (this.disposed || !this.prepared) return;
    this.state = this.initialState(); this.elapsed = 0; this.checkpoint = 0; this.keys.clear();
    this.windClock = 0; this.unchangedWind = true;
    this.refreshWind();
    this.weapons = this.weaponSimulation.reset(); this.previousWeapons = this.weapons;
    this.snapCamera = true;
    this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
    this.copyPreviousPose(); this.simulationClock.reset(performance.now()); this.renderPerformance.reset();
    this.collisionCooldown = 0; this.setStatus('flying'); this.emit();
    this.events.notice('起飞成功 · B 投弹，V 切换俯视瞄准 · 下方有练习靶标');
  }
  pause() {
    if (this.status !== 'flying') return;
    this.setStatus('paused'); this.keys.clear(); this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
    if (document.pointerLockElement) document.exitPointerLock(); this.emit();
  }
  togglePause() { if (this.status === 'flying') this.pause(); else if (this.status === 'paused') this.setStatus('flying'); }
  reset() {
    this.setStatus('ready'); this.state = this.initialState(); this.elapsed = 0; this.checkpoint = 0; this.keys.clear();
    this.windClock = 0; this.unchangedWind = true; this.collisionCooldown = 0;
    this.refreshWind();
    this.weapons = this.weaponSimulation.reset(); this.previousWeapons = this.weapons;
    this.copyPreviousPose(); this.simulationClock.reset(performance.now()); this.renderPerformance.reset();
    this.snapCamera = true; this.events.notice('');
    this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
    if (document.pointerLockElement) document.exitPointerLock(); this.emit();
  }
  private copyPreviousPose() {
    Object.assign(this.previousPose.position, this.state.position);
    this.previousPose.yaw = this.state.yaw; this.previousPose.pitch = this.state.pitch; this.previousPose.roll = this.state.roll;
  }
  private stepSimulation = (dt: number) => {
    this.copyPreviousPose();
    const previous = this.previousPose.position;
    const pressed = (code: string) => this.keys.has(code) ? 1 : 0;
    const result = this.simulation.step(this.state, {
      forward: pressed('KeyW') - pressed('KeyS') + this.touch.forward,
      strafe: pressed('KeyD') - pressed('KeyA') + this.touch.strafe,
      climb: pressed('Space') - Math.max(pressed('ShiftLeft'), pressed('ShiftRight')) + this.touch.climb,
      yaw: pressed('KeyQ') + pressed('ArrowLeft') - pressed('KeyE') - pressed('ArrowRight') + this.touch.yaw,
      lookPitch: pressed('ArrowUp') - pressed('ArrowDown'),
    }, dt, this.flightMode, getDroneSpec(this.selectedDroneId).flight, this.currentWind, this.windClock, this.mapSpec.bounds);
    this.windClock = result.windClock; this.wind = result.wind;
    this.elapsed += dt; this.collisionCooldown -= dt;
    if (result.boundaryContact) {
      if (this.collisionCooldown <= 0) { this.events.notice('已到达飞行场边界 · 转向继续探索'); this.collisionCooldown = 1.5; }
    }
    {
      const groundHit = this.state.collision;
      if (result.obstacleContact || groundHit) {
        if (this.collisionCooldown <= 0) {
          this.collisionCooldown = 1.5;
          if (this.mode === 'race') this.elapsed += 3;
          const contact = groundHit && this.state.position.y < WATER_LEVEL + 3 && this.worldKernel.isWater(this.state.position.x, this.state.position.z) ? '触水' : '碰撞';
          this.events.notice({ key: this.mode === 'race' ? '{contact} · 已稳住机身，计时增加 3 秒' : '{contact} · 已稳住机身，请升高或避开障碍', params: { contact } });
        }
      }
    }
    this.previousWeapons = this.weapons;
    const weaponEvents = this.weaponSimulation.step(dt);
    this.weapons = weaponEvents.state;
    if (weaponEvents.impacts > 0) {
      const impact = this.weapons.explosions.at(-1);
      this.audio.explosion(Boolean(impact && impact.position.y < WATER_LEVEL + 0.3 && this.worldKernel.isWater(impact.position.x, impact.position.z)));
    }
    if (weaponEvents.hits > 0) {
      this.events.notice(this.weapons.hitTargetIds.length === this.mapSpec.targets.length
        ? { key: '全部靶标命中 · 总得分 {score} · R 重新挑战', params: { score: this.weapons.score } }
        : { key: '命中靶标 +{points} · {hits} / {total}', params: { points: weaponEvents.hits * 100, hits: this.weapons.hitTargetIds.length, total: this.mapSpec.targets.length } });
    }
    if (this.mode === 'race' && this.checkpoint < this.mapSpec.checkpoints.length && crossesCheckpoint(previous, this.state.position, this.mapSpec.checkpoints[this.checkpoint])) {
      this.checkpoint++; this.audio.checkpoint();
      if (this.checkpoint === this.mapSpec.checkpoints.length) {
        this.setStatus('finished'); this.events.finish(this.elapsed);
        if (document.pointerLockElement) document.exitPointerLock();
      } else this.events.notice({ key: '检查点 {number} / {total} · 继续前往下一个飞行环', params: { number: String(this.checkpoint).padStart(2, '0'), total: this.mapSpec.checkpoints.length } });
    }
    return this.status === 'flying';
  };
  private tick = (time: number) => {
    if (this.disposed) return;
    const frameStart = performance.now();
    const elapsedDelta = this.lastTime ? Math.max((time - this.lastTime) / 1000, 0) : 0;
    const dt = Math.min(elapsedDelta, 0.25); this.lastTime = time;
    let alpha = 1;
    if (this.status === 'flying') alpha = this.simulationClock.tick(time, this.stepSimulation).alpha;
    else this.simulationClock.reset(time);
    const simulationEnd = performance.now();
    // Interpolate presentation only; collisions, checkpoints and telemetry use the Rust state.
    if (this.status === 'flying') {
      const previous = this.previousPose, current = this.state, display = this.displayPose;
      for (const axis of ['x', 'y', 'z'] as const) display.position[axis] = THREE.MathUtils.lerp(previous.position[axis], current.position[axis], alpha);
      const yawDelta = Math.atan2(Math.sin(current.yaw - previous.yaw), Math.cos(current.yaw - previous.yaw));
      display.yaw = previous.yaw + yawDelta * alpha;
      display.pitch = THREE.MathUtils.lerp(previous.pitch, current.pitch, alpha);
      display.roll = THREE.MathUtils.lerp(previous.roll, current.roll, alpha);
    }
    const { position, yaw, pitch, roll } = this.status === 'flying' ? this.displayPose : this.state;
    const velocity = this.state.velocity;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    this.drone.model.position.set(position.x, position.y, position.z);
    this.headlight.position.set(position.x - Math.sin(yaw) * 0.75, position.y - 0.1, position.z - Math.cos(yaw) * 0.75);
    this.headlightTarget.position.set(position.x - Math.sin(yaw) * 17, position.y - 5, position.z - Math.cos(yaw) * 17);
    const forwardVelocity = -Math.sin(yaw) * velocity.x - Math.cos(yaw) * velocity.z;
    if (this.selectedDroneId === 'falcon') {
      // The speed prototype's five streamlined pods share the +Y thrust axis:
      // upright in a hover, tipping toward the flight path as speed increases.
      const sideVelocity = Math.cos(yaw) * velocity.x - Math.sin(yaw) * velocity.z;
      this.drone.model.rotation.set(
        THREE.MathUtils.clamp(pitch * 0.15 - Math.atan2(forwardVelocity, 22), -1.37, 1.37), yaw,
        THREE.MathUtils.clamp(roll * 0.3 - Math.atan2(sideVelocity, 22), -1.2, 1.2));
    } else this.drone.model.rotation.set(pitch - forwardVelocity * 0.004, yaw, roll);
    this.drone.model.visible = this.cameraMode !== 'fpv';
    this.drone.update(time / 1000, this.status === 'flying', speed);
    if (this.cameraMode === 'fpv') {
      this.camera.position.set(position.x, position.y, position.z);
      this.camera.rotation.set(pitch - (this.status === 'ready' ? 0.06 : 0), yaw, roll);
    } else {
      // Follow yaw rather than bank/pitch so turns show the aircraft's attitude
      // while keeping the horizon steady and the route ahead visible.
      const heightAboveGround = Math.max(0, position.y - this.worldKernel.flightSurfaceHeight(position.x, position.z, position.y));
      const distanceBehind = this.cameraMode === 'bomb' ? Math.max(10, heightAboveGround * 0.55) : 8;
      const heightAbove = this.cameraMode === 'bomb' ? Math.max(15, heightAboveGround * 0.7) : 3.3;
      this.desiredPosition.set(position.x + Math.sin(yaw) * distanceBehind, position.y + heightAbove, position.z + Math.cos(yaw) * distanceBehind);
      this.desiredPosition.y = Math.max(this.desiredPosition.y, this.worldKernel.flightSurfaceHeight(this.desiredPosition.x, this.desiredPosition.z, this.desiredPosition.y) + 2);
      if (this.cameraMode === 'bomb') this.desiredTarget.set(position.x, this.worldKernel.flightSurfaceHeight(position.x, position.z, position.y) + 0.4, position.z);
      else this.desiredTarget.set(position.x - Math.sin(yaw) * 5, position.y + 0.8, position.z - Math.cos(yaw) * 5);
      if (this.snapCamera) {
        this.cameraPosition.copy(this.desiredPosition); this.cameraTarget.copy(this.desiredTarget);
      } else {
        const blend = 1 - Math.exp(-8 * dt);
        this.cameraPosition.lerp(this.desiredPosition, blend); this.cameraTarget.lerp(this.desiredTarget, blend);
      }
      this.cameraPosition.y = Math.max(this.cameraPosition.y, this.worldKernel.flightSurfaceHeight(this.cameraPosition.x, this.cameraPosition.z, this.cameraPosition.y) + 1.5);
      this.camera.position.copy(this.cameraPosition); this.camera.lookAt(this.cameraTarget);
    }
    this.snapCamera = false;
    this.world.update(time / 1000, this.mode === 'race' ? this.checkpoint : -1, position, this.camera.position);
    this.weaponVisuals.update(this.weapons, this.windClock, this.previousWeapons, this.status === 'flying' ? alpha : 1);
    const sceneEnd = performance.now();
    this.renderer.render(this.world.scene, this.camera);
    const renderEnd = performance.now();
    const pixelRatio = this.renderPerformance.recordFrame(time, simulationEnd - frameStart, sceneEnd - simulationEnd,
      renderEnd - sceneEnd, this.renderer.info, this.status === 'flying' && !document.hidden);
    if (pixelRatio !== undefined) {
      this.renderer.setPixelRatio(pixelRatio); this.resize();
    }
    this.audio.update(speed, this.status === 'flying');
    if (time - this.lastEmit > 90) {
      this.lastEmit = time; this.emit();
      const measurements = this.renderPerformance.snapshot();
      if (measurements !== this.lastPerformanceMetrics) {
        this.lastPerformanceMetrics = measurements;
        this.renderer.domElement.dataset.performanceMetrics = JSON.stringify(measurements);
      }
      this.renderer.domElement.dataset.pixelRatio = String(this.renderPerformance.pixelRatio);
      this.renderer.domElement.dataset.simulationTime = String(this.windClock);
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  private refreshWind() {
    // Configuration/reset events refresh Rust telemetry without advancing time
    // or contacts; normal flight advances every system in shared fixed substeps.
    const result = this.simulation.step(this.state, { forward: 0, strafe: 0, climb: 0, yaw: 0 }, 0,
      this.flightMode, getDroneSpec(this.selectedDroneId).flight, this.currentWind, this.windClock);
    this.wind = result.wind;
  }
  private emit() {
    const wind = this.wind.vector;
    this.events.telemetry({
      speed: Math.hypot(this.state.velocity.x, this.state.velocity.y, this.state.velocity.z) * 3.6,
      altitude: this.state.position.y, elapsed: this.elapsed, checkpoint: this.checkpoint,
      position: { ...this.state.position }, yaw: this.state.yaw, pitch: this.state.pitch, roll: this.state.roll,
      wind: this.wind,
      airSpeed: Math.hypot(this.state.velocity.x - wind.x, this.state.velocity.y - wind.y, this.state.velocity.z - wind.z) * 3.6,
      recordEligible: this.unchangedWind,
      weapons: { ammo: this.weapons.ammo, reloadRemaining: this.weapons.reloadRemaining,
        score: this.weapons.score, hitTargetIds: [...this.weapons.hitTargetIds] },
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame); this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('mousemove', this.mousemove); document.removeEventListener('pointerlockchange', this.pointerlockchange);
    this.renderer.domElement.removeEventListener('click', this.lockPointer);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.audio.dispose(); this.renderer.domElement.remove();
    this.assets.dispose();
    const release = () => {
      this.headlight.dispose(); this.drone.dispose(); this.maps.dispose();
      this.warmupTarget.dispose();
      this.renderer.dispose(); this.renderer.forceContextLoss();
    };
    // Three's async compiler polls program objects. Keep them valid until that poll finishes.
    if (this.compilation) void this.compilation.then(release, release);
    else release();
  }
}
