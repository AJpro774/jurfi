import { describe, expect, it } from 'vitest';
import { snapAngle, snapScalar, snapVec3 } from './snap';

describe('snap', () => {
  it('rounds to the step, including negatives', () => {
    expect(snapScalar(1.6, 1)).toBe(2);
    expect(snapScalar(-1.6, 1)).toBe(-2);
    expect(snapScalar(1.24, 0.25)).toBeCloseTo(1.25);
  });

  it('leaves values alone when the step is not positive or the value is not finite', () => {
    expect(snapScalar(1.2, 0)).toBe(1.2);
    expect(snapScalar(1.2, -1)).toBe(1.2);
    expect(snapScalar(Number.NaN, 1)).toBeNaN();
  });

  it('snaps vectors and angles component-wise', () => {
    const snapped = snapVec3({ x: 1.2, y: -0.4, z: 2.5 }, 1);
    expect(snapped.x).toBe(1);
    expect(snapped.y).toBeCloseTo(0);
    expect(snapped.z).toBe(3);
    expect(snapAngle((23 * Math.PI) / 180, Math.PI / 12)).toBeCloseTo(Math.PI / 6);
  });
});
