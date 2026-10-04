import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDrone } from '../game/drone.ts';
import { getDroneSpec } from '../game/drone-catalog.ts';
import type { DroneId } from '../game/drone-catalog.ts';
import { createDroneStudio, fitDroneCamera } from './drone-preview-stage.ts';
import './DroneModelPreview.css';
import { useI18n } from '../i18n/context';

export interface DroneModelPreviewProps { droneId: DroneId; className?: string }
interface PreviewRuntime {
  setModel(id: DroneId): void;
  reset(): void;
  rotate(horizontal: number, vertical?: number): void;
  zoom(factor: number): void;
  dispose(): void;
}

/** A single, interactive renderer. No animation loop is needed for a parked drone. */
export function DroneModelPreview({ droneId, className = '' }: DroneModelPreviewProps) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<PreviewRuntime | null>(null);
  const currentId = useRef(droneId);
  const descriptionId = useId();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const spec = getDroneSpec(droneId);
  const canvasLabel = t('{name}三维模型。拖动或方向键旋转，滚轮或加减键缩放，Home 复位。', { name: t(spec.name) });
  const canvasLabelRef = useRef(canvasLabel);
  canvasLabelRef.current = canvasLabel;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      let renderer: THREE.WebGLRenderer | undefined;
      let studio: ReturnType<typeof createDroneStudio> | undefined;
      let controls: OrbitControls | undefined;
      let resizeObserver: ResizeObserver | undefined;
      let drone: ReturnType<typeof createDrone> | undefined;
      let loadedId: DroneId | undefined;
      let disposed = false;
      let initialDistance = 1;
      const camera = new THREE.PerspectiveCamera(32, 360 / 250, 0.01, 30);
      const offset = new THREE.Vector3(); const spherical = new THREE.Spherical();
      const render = () => {
        if (!disposed && drone && renderer && studio) renderer.render(studio.scene, camera);
      };
      const fit = (preserveDirection = false) => {
        if (!drone || !controls) return;
        const direction = preserveDirection ? camera.position.clone().sub(controls.target).normalize() : undefined;
        const framing = fitDroneCamera(camera, drone.model, direction);
        controls.target.copy(framing.center);
        initialDistance = framing.distance;
        controls.minDistance = initialDistance * 0.60; controls.maxDistance = initialDistance * 2.2;
        controls.update(); render();
      };
      const resize = () => {
        if (disposed || !renderer) return;
        const rectangle = element.getBoundingClientRect();
        const width = Math.max(1, rectangle.width || 360); const height = Math.max(1, rectangle.height || 250);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, height, false);
        camera.aspect = width / height; camera.updateProjectionMatrix(); fit(true);
      };
      const contextLost = (event: Event) => {
        event.preventDefault();
        if (active && !disposed) { setFailed(true); setReady(false); runtime.current?.dispose(); runtime.current = null; }
      };
      const instance: PreviewRuntime = {
        setModel(id) {
          if (disposed || loadedId === id || !studio || !renderer) return;
          drone?.dispose(); drone = undefined;
          try {
            drone = createDrone(id); drone.update(0, false, 0); loadedId = id;
            studio.scene.add(drone.model);
            renderer.domElement.setAttribute('aria-label', canvasLabelRef.current);
            fit(); setReady(true); setFailed(false);
          } catch {
            if (active) { setFailed(true); setReady(false); }
            instance.dispose(); runtime.current = null;
          }
        },
        reset() { if (!disposed) fit(); },
        rotate(horizontal, vertical = 0) {
          if (disposed || !controls) return;
          offset.copy(camera.position).sub(controls.target); spherical.setFromVector3(offset);
          spherical.theta += horizontal;
          spherical.phi = THREE.MathUtils.clamp(spherical.phi + vertical, controls.minPolarAngle, controls.maxPolarAngle);
          camera.position.copy(offset.setFromSpherical(spherical)).add(controls.target); controls.update();
        },
        zoom(factor) {
          if (disposed || !controls) return;
          offset.copy(camera.position).sub(controls.target);
          offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
          camera.position.copy(controls.target).add(offset); controls.update();
        },
        dispose() {
          if (disposed) return; disposed = true;
          resizeObserver?.disconnect(); controls?.removeEventListener('change', render); controls?.dispose();
          renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
          drone?.dispose(); studio?.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
        },
      };
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        studio = createDroneStudio(renderer);
        const canvas = renderer.domElement;
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-describedby', descriptionId); canvas.tabIndex = 0;
        canvas.addEventListener('webglcontextlost', contextLost);
        element.append(canvas);
        controls = new OrbitControls(camera, canvas);
        controls.enableDamping = false; controls.autoRotate = false; controls.enablePan = false;
        controls.rotateSpeed = 0.75; controls.zoomSpeed = 0.8;
        controls.minPolarAngle = 0.08; controls.maxPolarAngle = Math.PI * 0.87;
        controls.addEventListener('change', render);
        runtime.current = instance;
        resize(); instance.setModel(currentId.current);
        if (disposed) return;
        resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element);
      } catch {
        instance.dispose(); runtime.current = null;
        if (active) { setFailed(true); setReady(false); }
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); runtime.current?.dispose(); runtime.current = null; };
  }, [descriptionId]);

  useEffect(() => { currentId.current = droneId; runtime.current?.setModel(droneId); }, [droneId]);
  // Language updates accessible copy without rebuilding the renderer or resetting OrbitControls.
  useEffect(() => { host.current?.querySelector('canvas')?.setAttribute('aria-label', canvasLabel); }, [canvasLabel]);

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const rotations: Record<string, [number, number]> = { ArrowLeft: [-0.18, 0], ArrowRight: [0.18, 0], ArrowUp: [0, -0.13], ArrowDown: [0, 0.13] };
    if (rotations[event.key]) { event.preventDefault(); runtime.current?.rotate(...rotations[event.key]); }
    else if (event.key === 'Home') { event.preventDefault(); runtime.current?.reset(); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); runtime.current?.zoom(0.88); }
    else if (event.key === '-') { event.preventDefault(); runtime.current?.zoom(1.14); }
  };

  return <section className={`drone-model-preview ${className}`} aria-label={t('{name}三维模型预览', { name: t(spec.name) })}
    onKeyDown={keyboard} onClick={event => event.stopPropagation()}>
    <div ref={host} className="drone-preview-canvas" aria-busy={!ready && !failed}>
      {!ready && <p className="drone-preview-status" role="status">{t(failed ? '当前设备暂时无法显示 3D 模型。' : '准备模型…')}</p>}
    </div>
    <div className="drone-preview-toolbar">
      <span id={descriptionId} className="drone-preview-hint">{t('拖动旋转 · 滚轮缩放')}</span>
      <div role="group" aria-label={t('模型观察视角')}>
        <button type="button" disabled={!ready} onClick={() => runtime.current?.rotate(-Math.PI / 6)} aria-label={t('向左旋转模型')} title={t('向左旋转')}>↶</button>
        <button type="button" disabled={!ready} onClick={() => runtime.current?.reset()} aria-label={t('复位模型视角与缩放')} title={t('恢复完整模型视角')}>{t('复位')}</button>
        <button type="button" disabled={!ready} onClick={() => runtime.current?.rotate(Math.PI / 6)} aria-label={t('向右旋转模型')} title={t('向右旋转')}>↷</button>
      </div>
    </div>
  </section>;
}
