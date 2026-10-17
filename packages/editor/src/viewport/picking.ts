import type { Vec3 } from '../math/vec';

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface PickItem {
  id: string;
  aabb: Aabb;
}

/**
 * Optional ID-buffer picker. @jurfi/render does not provide one yet.
 * When present, its result is authoritative (null is a miss, not a signal to raycast).
 */
export interface IdBufferPicker {
  pick(x: number, y: number): string | null;
}

export function pickWithFallback(
  idBuffer: IdBufferPicker | null,
  x: number,
  y: number,
  raycast: () => string | null,
): string | null {
  if (idBuffer) return idBuffer.pick(x, y);
  return raycast();
}

/** Slab test. Returns the entry distance, or null on a miss. */
export function rayAabb(origin: Vec3, dir: Vec3, box: Aabb): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axes = ['x', 'y', 'z'] as const;
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    const min = box.min[axis];
    const max = box.max[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < min || o > max) return null;
      continue;
    }
    let t1 = (min - o) / d;
    let t2 = (max - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export function pickClosest(origin: Vec3, dir: Vec3, items: readonly PickItem[]): string | null {
  let bestId: string | null = null;
  let bestT = Infinity;
  for (const item of items) {
    const t = rayAabb(origin, dir, item.aabb);
    if (t == null || t >= bestT) continue;
    bestT = t;
    bestId = item.id;
  }
  return bestId;
}
