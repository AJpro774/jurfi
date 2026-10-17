import { sampleTrack, type Track } from '@jurfi/anim';
import { describe, expect, it } from 'vitest';
import { sampleCurve } from './curve';
import { eulerDegreesToQuat } from './euler';

const bezier: Track = {
  id: 'x',
  target: { entity: 'hero', component: 'transform', prop: 'position', channel: 0 },
  type: 'number',
  keys: [
    { t: 0, v: 0, interp: 'bezier', outTan: { dt: 1 / 3, dv: 2 } },
    { t: 1, v: 1, interp: 'linear', inTan: { dt: -1 / 3, dv: 0 } },
  ],
};

describe('curve sampling', () => {
  it('reads bezier values from the runtime sampler', () => {
    expect(sampleTrack(bezier, 0)).toBe(0);
    expect(sampleTrack(bezier, 0.5)).toBeCloseTo(1.25, 5);
    expect(sampleTrack(bezier, 1)).toBe(1);
    const mid = sampleCurve(bezier, undefined, 0, 1, 2)[1];
    expect(mid?.v).toBeCloseTo(1.25, 5);
  });

  it('samples a linear scalar at the midpoint', () => {
    const linear: Track = {
      id: 'y',
      target: { entity: 'hero', component: 'transform', prop: 'position', channel: 1 },
      type: 'number',
      keys: [
        { t: 0, v: 0, interp: 'linear' },
        { t: 1, v: 10, interp: 'linear' },
      ],
    };
    expect(sampleTrack(linear, 0.5)).toBe(5);
  });

  it('plots a quaternion as one euler curve instead of four channels', () => {
    const quat: Track = {
      id: 'rot',
      target: { entity: 'hero', component: 'transform', prop: 'rotation' },
      type: 'quat',
      keys: [
        { t: 0, v: [0, 0, 0, 1], interp: 'linear' },
        { t: 1, v: eulerDegreesToQuat([0, 40, 0]), interp: 'linear' },
      ],
    };
    const pitch = sampleCurve(quat, 1, 0, 1, 4);
    expect(pitch).toHaveLength(5);
    expect(pitch[0]?.v).toBeCloseTo(0, 4);
    expect(pitch[4]?.v).toBeCloseTo(40, 3);
    expect(pitch[2]?.v).toBeGreaterThan(0);
    expect(pitch[2]?.v).toBeLessThan(40);
  });
});
