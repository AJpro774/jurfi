import { describe, expect, it } from 'vitest';
import { handlePoint, linearFallback, pointInRect, rangeOf, timeToX, valueToY, xToTime, yToValue } from './geometry';

describe('geometry', () => {
  it('maps time and value through the viewport', () => {
    expect(timeToX(2, 100)).toBe(200);
    expect(xToTime(200, 100)).toBe(2);
    const range = rangeOf([0, 10]);
    expect(valueToY(10, range, 100)).toBeLessThan(valueToY(0, range, 100));
    expect(yToValue(valueToY(4, range, 100), range, 100)).toBeCloseTo(4, 5);
  });

  it('treats a box drag in either direction as the same rectangle', () => {
    expect(pointInRect(1, 1, { x: 4, y: 4, w: -3, h: -3 })).toBe(true);
    expect(pointInRect(5, 1, { x: 0, y: 0, w: 2, h: 2 })).toBe(false);
  });

  it('places bezier handles at key + tangent', () => {
    const fallback = linearFallback(1, 3, 'out');
    expect(fallback).toEqual({ dt: 1 / 3, dv: 1 });
    expect(handlePoint(1, 2, { dt: 0.25, dv: -0.5 })).toEqual({ t: 1.25, v: 1.5 });
  });
});
