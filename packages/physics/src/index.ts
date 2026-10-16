import { clamp } from '@jurfi/core';

export interface Aabb { x: number; y: number; w: number; h: number }

export function overlaps(a: Aabb, b: Aabb): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export const clampPos = clamp;
