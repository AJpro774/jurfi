import { describe, expect, it } from 'vitest';
import { clampTime, niceStep, snapTime, snapValue } from './snap';

describe('snap', () => {
  it('snaps time to the clip frame grid', () => {
    expect(snapTime(0.02, 30, true)).toBeCloseTo(1 / 30, 6);
    expect(snapTime(0.02, 30, false)).toBe(0.02);
    expect(snapTime(1.04, 10, true)).toBeCloseTo(1, 6);
  });

  it('clamps to the clip duration', () => {
    expect(clampTime(-1, 2)).toBe(0);
    expect(clampTime(4, 2)).toBe(2);
    expect(clampTime(Number.NaN, 2)).toBe(0);
  });

  it('snaps values onto a grid', () => {
    expect(snapValue(1.24, 0.25, true)).toBeCloseTo(1.25, 6);
    expect(snapValue(1.24, 0.25, false)).toBe(1.24);
  });

  it('picks a readable ruler step', () => {
    expect(niceStep(10, 8)).toBe(1);
    expect(niceStep(100, 8)).toBe(10);
    expect(niceStep(0, 8)).toBe(1);
  });
});
