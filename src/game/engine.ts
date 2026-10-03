import * as THREE from 'three';
import { createFlightState, stepFlight, crossesCheckpoint } from './flight';
import { CHECKPOINTS, createWorld, groundHeight } from './world';
import { FlightAudio } from './audio';
import { createDrone } from './drone';
import type { RaceMode, FlightMode, CameraMode, Status, Telemetry } from './types';

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
  private camera = new THREE.PerspectiveCamera(68, 1, 0.2, 2100);
  private drone = createDrone();
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
  private checkpoint = 0;
  private collisionCooldown = 0;
  private resizeObserver: ResizeObserver;
  private touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
  mode: RaceMode = 'race';
  flightMode: FlightMode = 'assisted';
  cameraMode: CameraMode = 'chase';

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
    this.world.scene.add(this.drone.model);
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
    if ((event.target as HTMLElement)?.matches('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyV') {
      event.preventDefault(); if (!event.repeat) this.setCameraMode(this.cameraMode === 'chase' ? 'fpv' : 'chase'); return;
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault(); if (!event.repeat) { if (event.code === 'Escape') this.pause(); else this.togglePause(); } return;
    }
    if (event.code === 'KeyR' && !event.repeat && this.status !== 'ready') { event.preventDefault(); this.start(); return; }
    if (this.status !== 'flying') return;
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
    this.state.yaw -= event.movementX * 0.0025;
    this.state.pitch = THREE.MathUtils.clamp(this.state.pitch - event.movementY * 0.0025, -0.7, 0.7);
  };
  setTouch(axis: keyof typeof this.touch, value: number) { this.touch[axis] = value; }
  setCameraMode(mode: CameraMode) {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode; this.snapCamera = true; this.events.cameraMode(mode);
  }
  private setStatus(status: Status) { this.status = status; this.events.status(status); }
  start() {
    this.state = createFlightState(); this.elapsed = 0; this.checkpoint = 0; this.keys.clear();
    this.snapCamera = true;
    this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
    this.collisionCooldown = 0; this.setStatus('flying'); this.emit();
    this.events.notice(this.mode === 'race' ? '起飞成功 · 依次穿过亮色飞行环' : '起飞成功 · 山谷属于你，自由探索吧');
  }
  pause() {
    if (this.status !== 'flying') return;
    this.setStatus('paused'); this.keys.clear(); this.touch = { forward: 0, strafe: 0, climb: 0, yaw: 0 };
    if (document.pointerLockElement) document.exitPointerLock(); this.emit();
  }
  togglePause() { if (this.status === 'flying') this.pause(); else if (this.status === 'paused') this.setStatus('flying'); }
  reset() {
    this.setStatus('ready'); this.state = createFlightState(); this.elapsed = 0; this.checkpoint = 0; this.keys.clear();
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
      }, dt, this.flightMode, groundHeight);
      this.elapsed += elapsedDelta; this.collisionCooldown -= dt;
      const p = this.state.position;
      const constrained = {
        x: THREE.MathUtils.clamp(p.x, -600, 600),
        y: THREE.MathUtils.clamp(p.y, 1.8, 180),
        z: THREE.MathUtils.clamp(p.z, -800, 300),
      };
      if (constrained.x !== p.x || constrained.y !== p.y || constrained.z !== p.z) {
        this.state.position = constrained; this.state.velocity = { x: 0, y: 0, z: 0 };
        if (this.collisionCooldown <= 0) { this.events.notice('已到达飞行场边界 · 转向继续探索'); this.collisionCooldown = 1.5; }
      }
      {
        const obstacle = this.world.obstacles?.find(o => {
          const p = this.state.position;
          return Math.hypot(p.x - o.x, p.z - o.z) < o.radius + 0.55 && p.y < groundHeight(o.x, o.z) + o.height;
        });
        const groundHit = this.state.collision;
        if (obstacle || groundHit) {
          if (obstacle) { this.state.position = previous; this.state.velocity = { x: 0, y: 0, z: 0 }; }
          if (this.collisionCooldown <= 0) {
            this.collisionCooldown = 1.5;
            if (this.mode === 'race') this.elapsed += 3;
            this.events.notice(this.mode === 'race' ? '碰撞 · 已稳住机身，计时增加 3 秒' : '碰撞 · 已稳住机身，请避开障碍');
          }
        }
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
    const forwardVelocity = -Math.sin(yaw) * velocity.x - Math.cos(yaw) * velocity.z;
    this.drone.model.rotation.set(pitch - forwardVelocity * 0.004, yaw, roll);
    this.drone.model.visible = this.cameraMode === 'chase';
    this.drone.update(time / 1000, this.status === 'flying', speed);
    if (this.cameraMode === 'fpv') {
      this.camera.position.set(position.x, position.y, position.z);
      this.camera.rotation.set(pitch - (this.status === 'ready' ? 0.06 : 0), yaw, roll);
    } else {
      // Follow yaw rather than bank/pitch so turns show the aircraft's attitude
      // while keeping the horizon steady and the route ahead visible.
      this.desiredPosition.set(position.x + Math.sin(yaw) * 8, position.y + 3.3, position.z + Math.cos(yaw) * 8);
      this.desiredPosition.y = Math.max(this.desiredPosition.y, groundHeight(this.desiredPosition.x, this.desiredPosition.z) + 2);
      this.desiredTarget.set(position.x - Math.sin(yaw) * 5, position.y + 0.8, position.z - Math.cos(yaw) * 5);
      if (this.snapCamera) {
        this.cameraPosition.copy(this.desiredPosition); this.cameraTarget.copy(this.desiredTarget);
      } else {
        const blend = 1 - Math.exp(-8 * dt);
        this.cameraPosition.lerp(this.desiredPosition, blend); this.cameraTarget.lerp(this.desiredTarget, blend);
      }
      this.cameraPosition.y = Math.max(this.cameraPosition.y, groundHeight(this.cameraPosition.x, this.cameraPosition.z) + 1.5);
      this.camera.position.copy(this.cameraPosition); this.camera.lookAt(this.cameraTarget);
    }
    this.snapCamera = false;
    this.world.update(time / 1000, this.mode === 'race' ? this.checkpoint : -1);
    this.renderer.render(this.world.scene, this.camera);
    this.audio.update(speed, this.status === 'flying');
    if (time - this.lastEmit > 90) { this.lastEmit = time; this.emit(); }
    this.frame = requestAnimationFrame(this.tick);
  };
  private emit() {
    this.events.telemetry({
      speed: Math.hypot(this.state.velocity.x, this.state.velocity.y, this.state.velocity.z) * 3.6,
      altitude: this.state.position.y, elapsed: this.elapsed, checkpoint: this.checkpoint,
      position: { ...this.state.position }, yaw: this.state.yaw, pitch: this.state.pitch, roll: this.state.roll,
    });
  }
  dispose() {
    cancelAnimationFrame(this.frame); this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('mousemove', this.mousemove); document.removeEventListener('pointerlockchange', this.pointerlockchange);
    this.renderer.domElement.removeEventListener('click', this.lockPointer);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.audio.dispose(); this.drone.dispose(); this.world.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
