import { registerProjectSection } from '../project-sections';
import { createOrbitCamera, createOrthoCamera, type OrbitCamera, type OrthoCamera } from './camera';
import type { ViewMode } from './types';

/** Viewport camera stored in the project file under `camera`. */
export interface CameraDocument {
  view: ViewMode;
  orbit: OrbitCamera;
  ortho: OrthoCamera;
}

let document: CameraDocument = {
  view: '3d',
  orbit: createOrbitCamera(),
  ortho: createOrthoCamera(),
};

export function readCameraDocument(): CameraDocument {
  return structuredClone(document);
}

export function replaceCameraDocument(next: CameraDocument): void {
  document = structuredClone(next);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function vec3(value: unknown): { x: number; y: number; z: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = num(value.x);
  const y = num(value.y);
  const z = num(value.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
}

/** Accept a saved camera section, or return the current document when `data` is unusable. */
export function parseCameraDocument(data: unknown): CameraDocument | null {
  if (!isRecord(data) || !isRecord(data.orbit) || !isRecord(data.ortho)) return null;
  if (data.view !== '2d' && data.view !== '3d') return null;
  const orbitTarget = vec3(data.orbit.target);
  const orthoCenter = vec3(data.ortho.center);
  const yaw = num(data.orbit.yaw);
  const pitch = num(data.orbit.pitch);
  const distance = num(data.orbit.distance);
  const fov = num(data.orbit.fov);
  const orbitNear = num(data.orbit.near);
  const orbitFar = num(data.orbit.far);
  const halfHeight = num(data.ortho.halfHeight);
  const orthoNear = num(data.ortho.near);
  const orthoFar = num(data.ortho.far);
  if (
    !orbitTarget || !orthoCenter
    || yaw === undefined || pitch === undefined || distance === undefined || fov === undefined
    || orbitNear === undefined || orbitFar === undefined
    || halfHeight === undefined || orthoNear === undefined || orthoFar === undefined
  ) return null;
  return {
    view: data.view,
    orbit: { target: orbitTarget, yaw, pitch, distance, fov, near: orbitNear, far: orbitFar },
    ortho: { center: orthoCenter, halfHeight, near: orthoNear, far: orthoFar },
  };
}

/** Register the `camera` project section. `registerViewportPanel` does this. */
export function registerCameraSection(): () => void {
  return registerProjectSection('camera', {
    save: () => readCameraDocument(),
    load(data) {
      const parsed = parseCameraDocument(data);
      if (!parsed) {
        console.warn('Skipped project section "camera": invalid camera state');
        return;
      }
      replaceCameraDocument(parsed);
    },
  });
}
