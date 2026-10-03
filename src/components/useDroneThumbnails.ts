import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { DRONES } from '../game/drone-catalog.ts';
import type { DroneId } from '../game/drone-catalog.ts';
import { createDrone } from '../game/drone.ts';
import { createDroneStudio, fitDroneCamera } from './drone-preview-stage.ts';

export interface DroneThumbnails {
  images: Partial<Record<DroneId, string>>;
  loading: boolean;
  fallback: boolean;
  error: string | null;
}
interface RenderJob {
  renderer?: THREE.WebGLRenderer;
  studio?: ReturnType<typeof createDroneStudio>;
  camera?: THREE.PerspectiveCamera;
  timer?: ReturnType<typeof setTimeout>;
}

let snapshot: DroneThumbnails = { images: {}, loading: true, fallback: false, error: null };
const listeners = new Set<() => void>();
let job: RenderJob | null = null;
let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
const getSnapshot = () => snapshot;
const getServerSnapshot = () => snapshot;

function publish(next: DroneThumbnails) {
  snapshot = next; listeners.forEach(listener => listener());
}
function finish(current: RenderJob, error: string | null = null) {
  if (job !== current) return;
  job = null; clearTimeout(current.timer);
  current.studio?.dispose();
  current.renderer?.dispose(); current.renderer?.forceContextLoss();
  publish({ ...snapshot, loading: false, fallback: Boolean(error), error });
}
function renderNext(current: RenderJob) {
  if (job !== current) return;
  if (listeners.size === 0) { finish(current); return; }
  const spec = DRONES.find(drone => !snapshot.images[drone.id]);
  if (!spec) { finish(current); return; }
  let drone: ReturnType<typeof createDrone> | undefined;
  try {
    if (!current.renderer) {
      current.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      current.renderer.setPixelRatio(1); current.renderer.setSize(420, 280, false);
      current.studio = createDroneStudio(current.renderer);
      current.camera = new THREE.PerspectiveCamera(32, 420 / 280, 0.01, 30);
    }
    if (current.renderer.getContext().isContextLost()) throw new Error('WebGL context unavailable');
    drone = createDrone(spec.id);
    drone.update(0, false, 0);
    current.studio!.scene.add(drone.model);
    fitDroneCamera(current.camera!, drone.model);
    current.renderer.render(current.studio!.scene, current.camera!);
    const image = current.renderer.domElement.toDataURL('image/png');
    publish({ images: { ...snapshot.images, [spec.id]: image }, loading: true, fallback: false, error: null });
    // Let the browser paint each completed card. The same renderer serves all six.
    current.timer = setTimeout(() => renderNext(current), 16);
  } catch {
    finish(current, '当前设备暂时无法生成 3D 模型图片。');
  } finally {
    drone?.dispose();
  }
}
function ensureGeneration() {
  if (job || snapshot.fallback || DRONES.every(drone => snapshot.images[drone.id])) return;
  const current: RenderJob = {}; job = current;
  publish({ ...snapshot, loading: true });
  // A deferred start avoids allocating a throwaway context during StrictMode's
  // immediate subscribe / cleanup / subscribe lifecycle.
  current.timer = setTimeout(() => renderNext(current), 0);
}
function subscribe(listener: () => void) {
  clearTimeout(cancellationTimer); cancellationTimer = undefined;
  listeners.add(listener); ensureGeneration();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      cancellationTimer = setTimeout(() => {
        cancellationTimer = undefined;
        if (listeners.size === 0 && job) finish(job);
      }, 0);
    }
  };
}

/** Six cached PNGs made from the very same geometry and materials used in flight. */
export function useDroneThumbnails(): DroneThumbnails {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
