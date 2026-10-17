import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT, length, quatFromAxisAngle, quatMul, quatRotate, vec } from './vec';

describe('vec', () => {
  it('rotates +X to -Z around Y by a quarter turn', () => {
    const turned = quatRotate(quatFromAxisAngle(vec(0, 1, 0), Math.PI / 2), vec(1, 0, 0));
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(-1);
    expect(length(turned)).toBeCloseTo(1);
  });

  it('keeps identity on both sides of quaternion multiply', () => {
    const turn = quatFromAxisAngle(vec(1, 0, 0), 0.4);
    const left = quatMul(IDENTITY_QUAT, turn);
    const right = quatMul(turn, IDENTITY_QUAT);
    expect(left.x).toBeCloseTo(turn.x);
    expect(left.w).toBeCloseTo(turn.w);
    expect(right.y).toBeCloseTo(turn.y);
    expect(right.w).toBeCloseTo(turn.w);
    expect(length(quatRotate(turn, vec(0, 1, 0)))).toBeCloseTo(1);
  });
});
