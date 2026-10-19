import { add, dot, length, normalize, quatFromAxisAngle, quatMul, quatNormalize, quatRotate, scaleVec, sub } from '../math/vec';
import type { Quat, Transform, Vec3 } from '../math/vec';
import { snapScalar } from './snap';

export type AxisId = 'x' | 'y' | 'z';
export type PlaneId = 'xy' | 'yz' | 'xz';
export type GizmoHandle = AxisId | PlaneId | 'xyz';
export type GizmoSpace = 'world' | 'local';

export interface AxisMask {
  x: boolean;
  y: boolean;
  z: boolean;
}

export function worldAxis(axis: AxisId): Vec3 {
  if (axis === 'x') return { x: 1, y: 0, z: 0 };
  if (axis === 'y') return { x: 0, y: 1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

export function isAxis(handle: GizmoHandle): handle is AxisId {
  return handle === 'x' || handle === 'y' || handle === 'z';
}

export function isPlane(handle: GizmoHandle): handle is PlaneId {
  return handle === 'xy' || handle === 'yz' || handle === 'xz';
}

export function axisInSpace(axis: AxisId, rotation: Quat, space: GizmoSpace): Vec3 {
  const local = worldAxis(axis);
  return space === 'local' ? normalize(quatRotate(rotation, local)) : local;
}

export function planeNormal(plane: PlaneId, rotation: Quat, space: GizmoSpace): Vec3 {
  const unused: AxisId = plane === 'xy' ? 'z' : plane === 'yz' ? 'x' : 'y';
  return axisInSpace(unused, rotation, space);
}

export function planeMask(plane: PlaneId): AxisMask {
  if (plane === 'xy') return { x: true, y: true, z: false };
  if (plane === 'yz') return { x: false, y: true, z: true };
  return { x: true, y: false, z: true };
}

/** A drag plane that contains `axis` and faces the camera as squarely as possible. */
export function bestAxisPlaneNormal(axis: Vec3, cameraForward: Vec3): Vec3 {
  const dir = normalize(axis);
  const forward = normalize(cameraForward);
  const projected = sub(forward, scaleVec(dir, dot(forward, dir)));
  if (length(projected) < 1e-6) {
    const helper = Math.abs(dir.y) < 0.9 ? worldAxis('y') : worldAxis('x');
    return normalize(cross(dir, helper));
  }
  return normalize(projected);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function rayPlane(origin: Vec3, dir: Vec3, planePoint: Vec3, planeNormalVec: Vec3): Vec3 | null {
  const denom = dot(planeNormalVec, dir);
  if (Math.abs(denom) < 1e-8) return null;
  const t = dot(sub(planePoint, origin), planeNormalVec) / denom;
  if (t < 0) return null;
  return add(origin, scaleVec(dir, t));
}

export function signedAngle(from: Vec3, to: Vec3, axis: Vec3): number {
  if (length(from) < 1e-8 || length(to) < 1e-8) return 0;
  return Math.atan2(dot(cross(from, to), normalize(axis)), dot(from, to));
}

export function scaleFactor(startDistance: number, currentDistance: number): number {
  if (Math.abs(startDistance) < 1e-4) return 1;
  const factor = currentDistance / startDistance;
  if (!Number.isFinite(factor)) return 1;
  return Math.min(100, Math.max(-100, factor));
}

export function selectionPivot(positions: readonly Vec3[]): Vec3 | null {
  if (positions.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const position of positions) {
    x += position.x;
    y += position.y;
    z += position.z;
  }
  const n = positions.length;
  return { x: x / n, y: y / n, z: z / n };
}

/** Move along `axis`. Snap lands the affected world components on the grid. A zero delta does not snap. */
export function translateAlong(position: Vec3, axis: Vec3, delta: number, snap: number | null): Vec3 {
  if (Math.abs(delta) < 1e-8) return { ...position };
  const dir = normalize(axis);
  const moved = add(position, scaleVec(dir, delta));
  if (snap == null || !(snap > 0)) return moved;
  return {
    x: Math.abs(dir.x) > 1e-3 ? snapScalar(moved.x, snap) : position.x,
    y: Math.abs(dir.y) > 1e-3 ? snapScalar(moved.y, snap) : position.y,
    z: Math.abs(dir.z) > 1e-3 ? snapScalar(moved.z, snap) : position.z,
  };
}

export function translateByDelta(position: Vec3, delta: Vec3, snap: number | null, mask: AxisMask): Vec3 {
  if (length(delta) < 1e-8) return { ...position };
  const moved = add(position, delta);
  if (snap == null || !(snap > 0)) return moved;
  return {
    x: mask.x ? snapScalar(moved.x, snap) : position.x,
    y: mask.y ? snapScalar(moved.y, snap) : position.y,
    z: mask.z ? snapScalar(moved.z, snap) : position.z,
  };
}

export function applyRotate(rotation: Quat, axis: AxisId, angle: number, space: GizmoSpace): Quat {
  const delta = quatFromAxisAngle(worldAxis(axis), angle);
  const next = space === 'world' ? quatMul(delta, rotation) : quatMul(rotation, delta);
  return quatNormalize(next);
}

function finiteNonZero(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-4) return value < 0 ? -1e-4 : 1e-4;
  return value;
}

function sanitizeScale(scale: Vec3): Vec3 {
  return { x: finiteNonZero(scale.x), y: finiteNonZero(scale.y), z: finiteNonZero(scale.z) };
}

export function applyScale(
  scale: Vec3,
  rotation: Quat,
  axis: AxisId | 'uniform',
  factor: number,
  space: GizmoSpace,
  snap: number | null,
): Vec3 {
  const safe = Number.isFinite(factor) ? factor : 1;
  if (axis === 'uniform') {
    const next = { x: scale.x * safe, y: scale.y * safe, z: scale.z * safe };
    if (snap == null || !(snap > 0)) return sanitizeScale(next);
    return sanitizeScale({ x: snapScalar(next.x, snap), y: snapScalar(next.y, snap), z: snapScalar(next.z, snap) });
  }
  if (space === 'local') {
    const next = { ...scale, [axis]: scale[axis] * safe };
    if (snap == null || !(snap > 0)) return sanitizeScale(next);
    return sanitizeScale({ ...scale, [axis]: snapScalar(next[axis], snap) });
  }
  const world = worldAxis(axis);
  const weight = {
    x: Math.abs(dot(quatRotate(rotation, worldAxis('x')), world)),
    y: Math.abs(dot(quatRotate(rotation, worldAxis('y')), world)),
    z: Math.abs(dot(quatRotate(rotation, worldAxis('z')), world)),
  };
  const next = {
    x: scale.x * (1 + (safe - 1) * weight.x),
    y: scale.y * (1 + (safe - 1) * weight.y),
    z: scale.z * (1 + (safe - 1) * weight.z),
  };
  if (snap == null || !(snap > 0)) return sanitizeScale(next);
  return sanitizeScale({
    x: weight.x > 1e-3 ? snapScalar(next.x, snap) : scale.x,
    y: weight.y > 1e-3 ? snapScalar(next.y, snap) : scale.y,
    z: weight.z > 1e-3 ? snapScalar(next.z, snap) : scale.z,
  });
}

export function dragTranslate(start: Transform, axis: Vec3, delta: number, snap: number | null): Transform {
  return { ...start, position: translateAlong(start.position, axis, delta, snap) };
}

export function dragTranslatePlane(start: Transform, delta: Vec3, snap: number | null, mask: AxisMask): Transform {
  return { ...start, position: translateByDelta(start.position, delta, snap, mask) };
}

export function dragRotate(
  start: Transform,
  pivot: Vec3,
  axis: AxisId,
  angle: number,
  space: GizmoSpace,
  snap: number | null,
): Transform {
  const used = snap != null && snap > 0 ? snapScalar(angle, snap) : angle;
  const rotation = applyRotate(start.rotation, axis, used, space);
  const dir = space === 'world' ? worldAxis(axis) : quatRotate(start.rotation, worldAxis(axis));
  const turn = quatFromAxisAngle(dir, used);
  const position = add(pivot, quatRotate(turn, sub(start.position, pivot)));
  return { position, rotation, scale: start.scale };
}

export function dragScale(
  start: Transform,
  pivot: Vec3,
  axis: AxisId | 'uniform',
  factor: number,
  space: GizmoSpace,
  snap: number | null,
): Transform {
  const scale = applyScale(start.scale, start.rotation, axis, factor, space, snap);
  let used = factor;
  if (axis === 'uniform') used = start.scale.x !== 0 ? scale.x / start.scale.x : factor;
  else if (space === 'local') {
    const before = start.scale[axis];
    used = before !== 0 ? scale[axis] / before : factor;
  }
  if (!Number.isFinite(used)) used = 1;
  const offset = sub(start.position, pivot);
  let position = start.position;
  if (axis === 'uniform') position = add(pivot, scaleVec(offset, used));
  else {
    const dir = space === 'world' ? worldAxis(axis) : quatRotate(start.rotation, worldAxis(axis));
    const along = dot(offset, dir);
    position = add(start.position, scaleVec(dir, along * (used - 1)));
  }
  return { position, rotation: start.rotation, scale };
}
