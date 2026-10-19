import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT, length, quatFromAxisAngle, vec } from '../math/vec';
import {
  applyRotate,
  applyScale,
  axisInSpace,
  bestAxisPlaneNormal,
  dragRotate,
  dragScale,
  dragTranslate,
  planeMask,
  rayPlane,
  scaleFactor,
  selectionPivot,
  signedAngle,
  translateAlong,
  translateByDelta,
  worldAxis,
} from './gizmo-math';

const unit = { x: 1, y: 1, z: 1 };

describe('gizmo transforms', () => {
  it('translates along a world axis and snaps that component only', () => {
    const moved = translateAlong({ x: 0.2, y: 4, z: -1 }, worldAxis('x'), 1.2, 1);
    expect(moved.x).toBeCloseTo(1);
    expect(moved.y).toBe(4);
    expect(moved.z).toBe(-1);
    const untouched = translateAlong({ x: 0.2, y: 4, z: -1 }, worldAxis('x'), 0, 1);
    expect(untouched).toEqual({ x: 0.2, y: 4, z: -1 });
  });

  it('translates along a local axis after a quarter turn around Y', () => {
    const rotation = quatFromAxisAngle(worldAxis('y'), Math.PI / 2);
    const axis = axisInSpace('x', rotation, 'local');
    expect(axis.x).toBeCloseTo(0);
    expect(axis.z).toBeCloseTo(-1);
    const moved = dragTranslate(
      { position: { x: 0, y: 0, z: 0 }, rotation, scale: unit },
      axis,
      2,
      null,
    );
    expect(moved.position.z).toBeCloseTo(-2);
    expect(moved.rotation).toBe(rotation);
  });

  it('snaps a planar move without touching the locked axis', () => {
    const moved = translateByDelta({ x: 0, y: 0, z: 5 }, { x: 1.2, y: -0.4, z: 9 }, 1, planeMask('xy'));
    expect(moved.x).toBeCloseTo(1);
    expect(moved.y).toBeCloseTo(0);
    expect(moved.z).toBe(5);
  });

  it('premultiplies world rotation and postmultiplies local rotation', () => {
    const start = quatFromAxisAngle(worldAxis('x'), Math.PI / 2);
    const local = applyRotate(start, 'y', Math.PI / 2, 'local');
    const world = applyRotate(start, 'y', Math.PI / 2, 'world');
    const same = Math.abs(local.x * world.x + local.y * world.y + local.z * world.z + local.w * world.w);
    expect(same).toBeLessThan(0.99);
    const spun = dragRotate(
      { position: { x: 1, y: 0, z: 0 }, rotation: IDENTITY_QUAT, scale: unit },
      { x: 0, y: 0, z: 0 },
      'y',
      Math.PI / 2,
      'world',
      null,
    );
    expect(spun.position.x).toBeCloseTo(0);
    expect(spun.position.z).toBeCloseTo(-1);
  });

  it('snaps a rotation to the step before applying it', () => {
    const snapped = dragRotate(
      { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_QUAT, scale: unit },
      { x: 0, y: 0, z: 0 },
      'y',
      (20 * Math.PI) / 180,
      'local',
      Math.PI / 12,
    );
    const expected = quatFromAxisAngle(worldAxis('y'), Math.PI / 12);
    expect(snapped.rotation.y).toBeCloseTo(expected.y);
    expect(snapped.rotation.w).toBeCloseTo(expected.w);
  });

  it('scales a local axis, uniformly, and along world X after a yaw', () => {
    const local = applyScale(vec(2, 2, 2), IDENTITY_QUAT, 'x', 1.5, 'local', null);
    expect(local).toEqual({ x: 3, y: 2, z: 2 });
    const uniform = applyScale(vec(2, 3, 4), IDENTITY_QUAT, 'uniform', 2, 'world', 0.5);
    expect(uniform.x).toBeCloseTo(4);
    expect(uniform.y).toBeCloseTo(6);
    expect(uniform.z).toBeCloseTo(8);
    const yaw = quatFromAxisAngle(worldAxis('y'), Math.PI / 2);
    const worldScaled = applyScale(vec(2, 2, 2), yaw, 'x', 2, 'world', null);
    expect(worldScaled.x).toBeCloseTo(2);
    expect(worldScaled.y).toBeCloseTo(2);
    expect(worldScaled.z).toBeCloseTo(4);
    const around = dragScale(
      { position: { x: 2, y: 0, z: 0 }, rotation: IDENTITY_QUAT, scale: unit },
      { x: 0, y: 0, z: 0 },
      'uniform',
      2,
      'world',
      null,
    );
    expect(around.position.x).toBeCloseTo(4);
    expect(around.scale.x).toBeCloseTo(2);
  });

  it('refuses a zero scale', () => {
    const flat = applyScale(unit, IDENTITY_QUAT, 'y', 0, 'local', null);
    expect(Math.abs(flat.y)).toBeGreaterThan(0);
  });
});

describe('gizmo picking helpers', () => {
  it('builds a camera-facing plane that contains the axis', () => {
    const normal = bestAxisPlaneNormal(worldAxis('x'), { x: 0, y: 0, z: -1 });
    expect(Math.abs(normal.x)).toBeLessThan(1e-6);
    expect(length(normal)).toBeCloseTo(1);
    const fallback = bestAxisPlaneNormal(worldAxis('y'), worldAxis('y'));
    expect(Math.abs(fallback.y)).toBeLessThan(1e-6);
    expect(length(fallback)).toBeCloseTo(1);
  });

  it('intersects a ray with a plane and measures a signed angle', () => {
    const hit = rayPlane({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(hit).toEqual({ x: 0, y: 0, z: 0 });
    expect(rayPlane({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeNull();
    expect(signedAngle(worldAxis('x'), worldAxis('y'), worldAxis('z'))).toBeCloseTo(Math.PI / 2);
    expect(scaleFactor(2, 5)).toBeCloseTo(2.5);
    expect(scaleFactor(0, 5)).toBe(1);
  });

  it('averages selection positions', () => {
    expect(selectionPivot([])).toBeNull();
    expect(selectionPivot([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 4, z: 6 },
    ])).toEqual({ x: 1, y: 2, z: 3 });
  });
});
