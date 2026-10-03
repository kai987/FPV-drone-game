import * as THREE from 'three';
import { createFlightState, stepFlight, crossesCheckpoint } from './flight';
import { CHECKPOINTS, createWorld } from './world';
import type { WorldObstacle } from './world';
import { isWater, WORLD_BOUNDS, WATER_LEVEL } from './landscape';
import { flightSurfaceHeight } from './surfaces';
import { intersectsObstacle } from './collisions';
import { FlightAudio } from './audio';
import { createDrone } from './drone';
import { DEFAULT_DRONE_ID, DRONES, getDroneSpec } from './drone-catalog';
import type { DroneId } from './drone-catalog';
import { createWeaponState, dropBomb, stepWeapons, TARGETS } from './weapons';
import { createWeaponVisuals } from './weapon-visuals';
import type { RaceMode, FlightMode, CameraMode, Status, Telemetry } from './types';
import { DEFAULT_WIND_SETTINGS, sampleWind, describeWind } from './wind';
import type { WindSettings } from './wind';

export interface EngineEvents {
  telemetry: (value: Telemetry) => void;
  status: (value: Status) => void;
  notice: (value: string) => void;
  finish: (seconds: number) => void;
  cameraMode: (value: CameraMode) => void;
}

export class FlightEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly audio = new FlightAudio();
  private world = createWorld();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.2, 10000);
  private obstacleGrid = new Map<string, WorldObstacle[]>();
  private drone = createDrone();
  private selectedDroneId: DroneId = DEFAULT_DRONE_ID;
  private disposed = false;
  private headlight = new THREE.SpotLight('#dcecff', 0, 85, Math.PI / 5, 0.55, 1.5);
  private headlightTarget = new THREE.Object3D();
  private weapons = createWeaponState();
  private weaponVisuals = createWeaponVisuals();
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private snapCamera = true;
  private state = createFlightState();
  private status: Status = 'ready';
  private keys = new Set<string>();
  private frame = 0;
  private lastTime = 0;
  private lastEmit = 0;
  private elapsed = 0;
  private windClock = 0;
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

  constructor(private host: HTMLDivElement, private events: EngineEvents) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '三维山谷飞行画面，飞行时点击可启用鼠标视角');
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
    // Index static obstacles once; a larger forest should not require scanning
    // thousands of distant trunks on every animation frame.
    for (const obstacle of this.world.obstacles) {
      const radius = obstacle.radius + 0.55;
      for (let x = Math.floor((obstacle.x - radius) / 64); x <= Math.floor((obstacle.x + radius) / 64); x++) {
        for (let z = Math.floor((obstacle.z - radius) / 64); z <= Math.floor((obstacle.z + radius) / 64); z++) {
          const key = `${x},${z}`;
          const cell = this.obstacleGrid.get(key) ?? [];
          cell.push(obstacle); this.obstacleGrid.set(key, cell);
        }
      }
    }
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('mousemove', this.mousemove);
    document.addEventListener('pointerlockchange', this.pointerlockchange);
    this.renderer.domElement.addEventListener('click', this.lockPointer);
    this.resize(); this.tick(0);
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
    this.world.setNight(enabled);
    this.weaponVisuals.setNight(enabled);
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
    this.events.notice(`已选择 ${getDroneSpec(id).name} · 参考参数可在机库查看`);
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
    if (dropBomb(this.weapons, this.state.position, this.state.velocity)) {
      this.audio.drop(); this.emit();
      if (this.weapons.ammo === 0) this.events.notice('弹药已投完 · 3 秒后自动补充');
    }
  }
  private setStatus(status: Status) { this.status = status; this.events.status(status); }
  start() {
    this.state = createFlightState(); this.elapsed = 0; this.checkpoint = 0; this.keys.clear();
    this.windClock = 0; this.unchangedWind = true;
    this.weapons = createWeaponState();
    this.snapCamera = true;
    this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
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
    this.setStatus('ready'); this.state = createFlightState(); this.elapsed = 0; this.checkpoint = 0; this.keys.clear();
    this.windClock = 0; this.unchangedWind = true;
    this.weapons = createWeaponState();
    this.snapCamera = true; this.events.notice('');
    this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
    if (document.pointerLockElement) document.exitPointerLock(); this.emit();
  }
  private tick = (time: number) => {
    const elapsedDelta = Math.max((time - this.lastTime) / 1000, 0);
    const dt = Math.min(elapsedDelta, 0.05); this.lastTime = time;
    if (this.status === 'flying') {
      const previous = { ...this.state.position };
      const pressed = (code: string) => this.keys.has(code) ? 1 : 0;
      stepFlight(this.state, {
        forward: pressed('KeyW') - pressed('KeyS') + this.touch.forward,
        strafe: pressed('KeyD') - pressed('KeyA') + this.touch.strafe,
        climb: pressed('Space') - Math.max(pressed('ShiftLeft'), pressed('ShiftRight')) + this.touch.climb,
        yaw: pressed('KeyQ') + pressed('ArrowLeft') - pressed('KeyE') - pressed('ArrowRight') + this.touch.yaw,
        lookPitch: pressed('ArrowUp') - pressed('ArrowDown'),
      }, dt, this.flightMode, (x, z) => flightSurfaceHeight(x, z, previous.y), getDroneSpec(this.selectedDroneId).flight,
      sampleWind(this.currentWind, this.windClock + dt * 0.5, previous));
      this.windClock += dt;
      this.elapsed += elapsedDelta; this.collisionCooldown -= dt;
      const p = this.state.position;
      const x = THREE.MathUtils.clamp(p.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
      const z = THREE.MathUtils.clamp(p.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
      const floor = flightSurfaceHeight(x, z, previous.y) + 1.8;
      const constrained = { x, z, y: THREE.MathUtils.clamp(p.y, floor, Math.max(floor, WORLD_BOUNDS.maxAltitude)) };
      if (constrained.x !== p.x || constrained.y !== p.y || constrained.z !== p.z) {
        this.state.position = constrained; this.state.velocity = { x: 0, y: 0, z: 0 };
        if (this.collisionCooldown <= 0) { this.events.notice('已到达飞行场边界 · 转向继续探索'); this.collisionCooldown = 1.5; }
      }
      {
        const nearby = this.obstacleGrid.get(`${Math.floor(this.state.position.x / 64)},${Math.floor(this.state.position.z / 64)}`);
        const obstacle = nearby?.find(o => intersectsObstacle(this.state.position, o));
        const groundHit = this.state.collision;
        if (obstacle || groundHit) {
          if (obstacle) { this.state.position = previous; this.state.velocity = { x: 0, y: 0, z: 0 }; }
          if (this.collisionCooldown <= 0) {
            this.collisionCooldown = 1.5;
            if (this.mode === 'race') this.elapsed += 3;
            const contact = groundHit && this.state.position.y < WATER_LEVEL + 3 && isWater(this.state.position.x, this.state.position.z) ? '触水' : '碰撞';
            this.events.notice(this.mode === 'race' ? `${contact} · 已稳住机身，计时增加 3 秒` : `${contact} · 已稳住机身，请升高或避开障碍`);
          }
        }
      }
      const weaponEvents = stepWeapons(this.weapons, elapsedDelta, flightSurfaceHeight);
      if (weaponEvents.impacts > 0) {
        const impact = this.weapons.explosions.at(-1);
        this.audio.explosion(Boolean(impact && impact.position.y < WATER_LEVEL + 0.3 && isWater(impact.position.x, impact.position.z)));
      }
      if (weaponEvents.hits > 0) {
        this.events.notice(this.weapons.hitTargetIds.length === TARGETS.length
          ? `全部靶标命中 · 总得分 ${this.weapons.score} · R 重新挑战`
          : `命中靶标 +${weaponEvents.hits * 100} · ${this.weapons.hitTargetIds.length} / ${TARGETS.length}`);
      }
      if (this.mode === 'race' && this.checkpoint < CHECKPOINTS.length && crossesCheckpoint(previous, this.state.position, CHECKPOINTS[this.checkpoint])) {
        this.checkpoint++; this.audio.checkpoint();
        if (this.checkpoint === CHECKPOINTS.length) {
          this.setStatus('finished'); this.events.finish(this.elapsed);
          if (document.pointerLockElement) document.exitPointerLock();
        } else this.events.notice(`检查点 ${String(this.checkpoint).padStart(2, '0')} / 08 · 继续前往下一个飞行环`);
      }
    }
    const { position, velocity, yaw, pitch, roll } = this.state;
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
      const heightAboveGround = Math.max(0, position.y - flightSurfaceHeight(position.x, position.z, position.y));
      const distanceBehind = this.cameraMode === 'bomb' ? Math.max(10, heightAboveGround * 0.55) : 8;
      const heightAbove = this.cameraMode === 'bomb' ? Math.max(15, heightAboveGround * 0.7) : 3.3;
      this.desiredPosition.set(position.x + Math.sin(yaw) * distanceBehind, position.y + heightAbove, position.z + Math.cos(yaw) * distanceBehind);
      this.desiredPosition.y = Math.max(this.desiredPosition.y, flightSurfaceHeight(this.desiredPosition.x, this.desiredPosition.z, this.desiredPosition.y) + 2);
      if (this.cameraMode === 'bomb') this.desiredTarget.set(position.x, flightSurfaceHeight(position.x, position.z, position.y) + 0.4, position.z);
      else this.desiredTarget.set(position.x - Math.sin(yaw) * 5, position.y + 0.8, position.z - Math.cos(yaw) * 5);
      if (this.snapCamera) {
        this.cameraPosition.copy(this.desiredPosition); this.cameraTarget.copy(this.desiredTarget);
      } else {
        const blend = 1 - Math.exp(-8 * dt);
        this.cameraPosition.lerp(this.desiredPosition, blend); this.cameraTarget.lerp(this.desiredTarget, blend);
      }
      this.cameraPosition.y = Math.max(this.cameraPosition.y, flightSurfaceHeight(this.cameraPosition.x, this.cameraPosition.z, this.cameraPosition.y) + 1.5);
      this.camera.position.copy(this.cameraPosition); this.camera.lookAt(this.cameraTarget);
    }
    this.snapCamera = false;
    this.world.update(time / 1000, this.mode === 'race' ? this.checkpoint : -1, position);
    this.weaponVisuals.update(this.weapons, this.elapsed);
    this.renderer.render(this.world.scene, this.camera);
    this.audio.update(speed, this.status === 'flying');
    if (time - this.lastEmit > 90) { this.lastEmit = time; this.emit(); }
    this.frame = requestAnimationFrame(this.tick);
  };
  private emit() {
    const wind = sampleWind(this.currentWind, this.windClock, this.state.position);
    this.events.telemetry({
      speed: Math.hypot(this.state.velocity.x, this.state.velocity.y, this.state.velocity.z) * 3.6,
      altitude: this.state.position.y, elapsed: this.elapsed, checkpoint: this.checkpoint,
      position: { ...this.state.position }, yaw: this.state.yaw, pitch: this.state.pitch, roll: this.state.roll,
      wind: { ...describeWind(wind, this.state.yaw), vector: wind },
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
    this.headlight.dispose(); this.audio.dispose(); this.drone.dispose(); this.weaponVisuals.dispose(); this.world.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
