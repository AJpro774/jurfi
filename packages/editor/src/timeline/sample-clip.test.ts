import { validateClip } from '@jurfi/anim';
import { describe, expect, it } from 'vitest';
import { createSampleClip } from './sample-clip';

describe('sample clip', () => {
  it('matches the runtime clip schema', () => {
    const clip = createSampleClip();
    expect(validateClip(clip)).toEqual([]);
    const rot = clip.tracks.find((track) => track.id === 'rot');
    expect(rot?.type).toBe('quat');
    expect(rot?.target.channel).toBeUndefined();
    expect(rot?.keys.every((key) => Array.isArray(key.v) && key.v.length === 4)).toBe(true);
    expect(clip.tracks.filter((track) => track.target.prop === 'position').every((track) => track.target.channel !== undefined)).toBe(true);
    expect(clip.fps).toBeGreaterThan(0);
    expect(clip.loop).toBe(true);
  });
});
