import { clamp } from '@jurfi/core';

/** Axis-aligned box in 2D. `x` and `y` are the minimum corner. */
export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when the two boxes overlap, including edge contact. */
export function overlaps(a: Aabb, b: Aabb): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Clamp a scalar into `[min, max]`. Same function as `@jurfi/core`'s `clamp`. */
export const clampPos = clamp;
