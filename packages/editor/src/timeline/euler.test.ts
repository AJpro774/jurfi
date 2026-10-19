import { describe, expect, it } from 'vitest';
import { eulerDegreesToQuat, eulerToQuat, quatToEuler, quatToEulerDegrees } from './euler';

describe('euler', () => {
  it('round-trips an XYZ euler through a unit quaternion', () => {
    const quat = eulerToQuat(0.2, -0.4, 0.5);
    const length = Math.hypot(...quat);
    expect(length).toBeCloseTo(1, 6);
    const back = quatToEuler(quat);
    expect(back[0]).toBeCloseTo(0.2, 5);
    expect(back[1]).toBeCloseTo(-0.4, 5);
    expect(back[2]).toBeCloseTo(0.5, 5);
  });

  it('round-trips degrees and keeps identity stable', () => {
    expect(quatToEulerDegrees(eulerDegreesToQuat([0, 90, 0]))[1]).toBeCloseTo(90, 4);
    expect(quatToEuler([0, 0, 0, 1])).toEqual([0, 0, 0]);
  });
});
