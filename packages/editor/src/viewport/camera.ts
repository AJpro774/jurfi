import { clamp } from '@jurfi/core';
import { add, cross, length, normalize, scaleVec, sub, vec } from '../math/vec';
import type { Vec3 } from '../math/vec';

export const MIN_ORBIT_DISTANCE = 0.2;
export const MAX_ORBIT_DISTANCE = 5000;
export const MIN_PITCH = -Math.PI / 2 + 0.02;
export const MAX_PITCH = Math.PI / 2 - 0.02;
export const ORBIT_RADIANS_PER_PIXEL = 0.005;
export const ZOOM_WHEEL_SCALE = 0.001;
export const MIN_ORTHO_HALF = 0.05;
export const MAX_ORTHO_HALF = 5000;
const FOCUS_PADDING = 1.4;

export interface OrbitCamera {
  target: Vec3;
  /** Radians around world Y. 0 looks from +Z toward the target. */
  yaw: number;
  /** Radians above the XZ plane. */
  pitch: number;
  distance: number;
  /** Vertical field of view in degrees. */
  fov: number;
  near: number;
  far: number;
}

export interface OrthoCamera {
  center: Vec3;
  /** Half the visible height in world units. */
  halfHeight: number;
  near: number;
  far: number;
}

export interface CameraBasis {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export function createOrbitCamera(): OrbitCamera {
  return {
    target: { x: 0, y: 0, z: 0 },
    yaw: Math.PI / 6,
    pitch: Math.PI / 8,
    distance: 8,
    fov: 50,
    near: 0.05,
    far: 5000,
  };
}

export function createOrthoCamera(): OrthoCamera {
  return {
    center: { x: 0, y: 0, z: 0 },
    halfHeight: 6,
    near: 0.05,
    far: 500,
  };
}

export function orbitEye(cam: OrbitCamera): Vec3 {
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  return {
    x: cam.target.x + cam.distance * cp * sy,
    y: cam.target.y + cam.distance * sp,
    z: cam.target.z + cam.distance * cp * cy,
  };
}

export function cameraBasis(cam: OrbitCamera): CameraBasis {
  const eye = orbitEye(cam);
  const forward = normalize(sub(cam.target, eye));
  const worldUp = vec(0, 1, 0);
  let right = cross(forward, worldUp);
  if (length(right) < 1e-6) right = vec(1, 0, 0);
  else right = normalize(right);
  const up = normalize(cross(right, forward));
  return { eye, forward, right, up };
}

/** Positive `dx` (pointer moving right) orbits so the scene follows the pointer. */
export function orbitDrag(
  cam: OrbitCamera,
  dxPx: number,
  dyPx: number,
  radiansPerPixel = ORBIT_RADIANS_PER_PIXEL,
): OrbitCamera {
  return {
    ...cam,
    yaw: cam.yaw - dxPx * radiansPerPixel,
    pitch: clamp(cam.pitch - dyPx * radiansPerPixel, MIN_PITCH, MAX_PITCH),
  };
}

/** Grab-pan. Pointer moving right moves the target left in camera space. */
export function panOrbit(cam: OrbitCamera, dxPx: number, dyPx: number, viewportHeight: number): OrbitCamera {
  const { right, up } = cameraBasis(cam);
  const halfFov = (cam.fov * Math.PI) / 360;
  const k = (2 * cam.distance * Math.tan(halfFov)) / Math.max(viewportHeight, 1);
  const target = add(cam.target, add(scaleVec(right, -dxPx * k), scaleVec(up, -dyPx * k)));
  return { ...cam, target };
}

/** Positive `wheelDeltaY` (scroll down) increases distance. */
export function zoomOrbit(cam: OrbitCamera, wheelDeltaY: number): OrbitCamera {
  const distance = clamp(cam.distance * Math.exp(wheelDeltaY * ZOOM_WHEEL_SCALE), MIN_ORBIT_DISTANCE, MAX_ORBIT_DISTANCE);
  return { ...cam, distance };
}

export function focusOrbit(cam: OrbitCamera, center: Vec3, radius: number): OrbitCamera {
  const halfFov = (cam.fov * Math.PI) / 360;
  const distance = clamp((Math.max(radius, 0.5) / Math.tan(halfFov)) * FOCUS_PADDING, MIN_ORBIT_DISTANCE, MAX_ORBIT_DISTANCE);
  return { ...cam, target: { ...center }, distance };
}

export function panOrtho(cam: OrthoCamera, dxPx: number, dyPx: number, viewportHeight: number): OrthoCamera {
  const unitsPerPx = (cam.halfHeight * 2) / Math.max(viewportHeight, 1);
  return {
    ...cam,
    center: {
      x: cam.center.x - dxPx * unitsPerPx,
      y: cam.center.y + dyPx * unitsPerPx,
      z: cam.center.z,
    },
  };
}

export function zoomOrtho(cam: OrthoCamera, wheelDeltaY: number): OrthoCamera {
  const halfHeight = clamp(cam.halfHeight * Math.exp(wheelDeltaY * ZOOM_WHEEL_SCALE), MIN_ORTHO_HALF, MAX_ORTHO_HALF);
  return { ...cam, halfHeight };
}

export function focusOrtho(cam: OrthoCamera, center: Vec3, radius: number): OrthoCamera {
  return {
    ...cam,
    center: { x: center.x, y: center.y, z: 0 },
    halfHeight: clamp(Math.max(radius, 0.5) * FOCUS_PADDING, MIN_ORTHO_HALF, MAX_ORTHO_HALF),
  };
}

export function focusBounds(items: readonly { position: Vec3; scale: Vec3 }[]): { center: Vec3; radius: number } | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const item of items) {
    const reach = 0.5 * Math.max(Math.abs(item.scale.x), Math.abs(item.scale.y), Math.abs(item.scale.z));
    minX = Math.min(minX, item.position.x - reach);
    minY = Math.min(minY, item.position.y - reach);
    minZ = Math.min(minZ, item.position.z - reach);
    maxX = Math.max(maxX, item.position.x + reach);
    maxY = Math.max(maxY, item.position.y + reach);
    maxZ = Math.max(maxZ, item.position.z + reach);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  const radius = Math.max(length(sub(vec(maxX, maxY, maxZ), vec(minX, minY, minZ))) * 0.5, 0.5);
  return { center, radius };
}

/** Convert WheelEvent delta into CSS pixels. */
export function normalizeWheel(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 800;
  return deltaY;
}
