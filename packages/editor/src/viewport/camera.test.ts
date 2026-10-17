import { describe, expect, it } from 'vitest';
import { length, sub } from '../math/vec';
import {
  createOrbitCamera,
  createOrthoCamera,
  focusBounds,
  focusOrbit,
  focusOrtho,
  normalizeWheel,
  orbitDrag,
  orbitEye,
  panOrbit,
  panOrtho,
  zoomOrbit,
  zoomOrtho,
  MIN_ORBIT_DISTANCE,
  MIN_PITCH,
  MAX_PITCH,
} from './camera';

describe('orbit camera', () => {
  it('places the eye on +Z when yaw and pitch are zero', () => {
    const eye = orbitEye({ ...createOrbitCamera(), yaw: 0, pitch: 0, distance: 10, target: { x: 1, y: 2, z: 3 } });
    expect(eye.x).toBeCloseTo(1);
    expect(eye.y).toBeCloseTo(2);
    expect(eye.z).toBeCloseTo(13);
  });

  it('orbits without changing distance and clamps pitch', () => {
    const cam = { ...createOrbitCamera(), yaw: 0.2, pitch: 0, distance: 8 };
    const turned = orbitDrag(cam, 40, -20);
    expect(turned.yaw).toBeLessThan(cam.yaw);
    expect(turned.pitch).toBeGreaterThan(cam.pitch);
    expect(length(sub(orbitEye(turned), turned.target))).toBeCloseTo(turned.distance);
    const clamped = orbitDrag(cam, 0, -100000);
    expect(clamped.pitch).toBeCloseTo(MAX_PITCH);
    expect(orbitDrag(cam, 0, 100000).pitch).toBeCloseTo(MIN_PITCH);
  });

  it('pans in camera space and zooms toward the minimum distance', () => {
    const cam = { ...createOrbitCamera(), yaw: 0, pitch: 0, distance: 10, fov: 50, target: { x: 0, y: 0, z: 0 } };
    const panned = panOrbit(cam, 10, 0, 100);
    expect(panned.target.x).toBeLessThan(0);
    expect(panned.target.y).toBeCloseTo(0);
    expect(panned.distance).toBe(cam.distance);
    const zoomed = zoomOrbit({ ...cam, distance: MIN_ORBIT_DISTANCE }, -500);
    expect(zoomed.distance).toBe(MIN_ORBIT_DISTANCE);
    expect(zoomOrbit(cam, 100).distance).toBeGreaterThan(cam.distance);
  });

  it('frames a selection from its bounds', () => {
    const bounds = focusBounds([
      { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { position: { x: 2, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ]);
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    expect(bounds.center.x).toBeCloseTo(1);
    const framed = focusOrbit({ ...createOrbitCamera(), fov: 50 }, bounds.center, bounds.radius);
    expect(framed.target).toEqual(bounds.center);
    expect(framed.distance).toBeCloseTo((bounds.radius / Math.tan((50 * Math.PI) / 360)) * 1.4);
  });
});

describe('orthographic camera', () => {
  it('pans with the pointer and zooms the half height', () => {
    const cam = createOrthoCamera();
    const panned = panOrtho(cam, 10, -5, 100);
    expect(panned.center.x).toBeLessThan(cam.center.x);
    expect(panned.center.y).toBeLessThan(cam.center.y);
    const zoomed = zoomOrtho(cam, -200);
    expect(zoomed.halfHeight).toBeLessThan(cam.halfHeight);
    const framed = focusOrtho(cam, { x: 3, y: 4, z: 9 }, 2);
    expect(framed.center).toEqual({ x: 3, y: 4, z: 0 });
    expect(framed.halfHeight).toBeCloseTo(2.8);
  });

  it('normalizes line and page wheel deltas into pixels', () => {
    expect(normalizeWheel(2, 0)).toBe(2);
    expect(normalizeWheel(2, 1)).toBe(32);
    expect(normalizeWheel(1, 2)).toBe(800);
  });
});
