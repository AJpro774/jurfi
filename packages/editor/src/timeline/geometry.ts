import type { Tangent } from '@jurfi/anim';

export function timeToX(time: number, pixelsPerSecond: number): number {
  return time * pixelsPerSecond;
}

export function xToTime(x: number, pixelsPerSecond: number): number {
  if (!(pixelsPerSecond > 0) || !Number.isFinite(x)) return 0;
  return x / pixelsPerSecond;
}

export interface ValueRange {
  min: number;
  max: number;
}

export function rangeOf(values: readonly number[], padRatio = 0.15): ValueRange {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -1, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) > 1e-6 ? Math.abs(min) * 0.5 : 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * padRatio;
  return { min: min - pad, max: max + pad };
}

export function valueToY(value: number, range: ValueRange, height: number): number {
  const span = range.max - range.min || 1;
  if (!(height > 0)) return 0;
  return height - ((value - range.min) / span) * height;
}

export function yToValue(y: number, range: ValueRange, height: number): number {
  const span = range.max - range.min || 1;
  if (!(height > 0)) return range.min;
  return range.min + ((height - y) / height) * span;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  const x0 = Math.min(rect.x, rect.x + rect.w);
  const x1 = Math.max(rect.x, rect.x + rect.w);
  const y0 = Math.min(rect.y, rect.y + rect.h);
  const y1 = Math.max(rect.y, rect.y + rect.h);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** Default cubic handle when a bezier key has no explicit tangent. Matches the runtime. */
export function linearFallback(span: number, delta: number, side: 'in' | 'out'): Tangent {
  if (!(span > 0)) return { dt: 0, dv: 0 };
  if (side === 'out') return { dt: span / 3, dv: delta / 3 };
  return { dt: -span / 3, dv: -delta / 3 };
}

/** Screen-space handle: control is `(key.t + dt, component + dv)`. */
export function handlePoint(time: number, component: number, tangent: Tangent): { t: number; v: number } {
  return { t: time + tangent.dt, v: component + tangent.dv };
}
