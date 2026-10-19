import type { Clip } from '@jurfi/anim';
import { describe, expect, it } from 'vitest';
import { createSampleClip } from './sample-clip';
import { buildRows } from './rows';

function rot(clip: Clip) {
  const track = clip.tracks.find((item) => item.id === 'rot');
  if (!track) throw new Error('missing rot');
  return track;
}

describe('rows', () => {
  it('keeps a quaternion as one dopesheet row', () => {
    const rows = buildRows(createSampleClip(), new Set(), 'dopesheet');
    const quatRows = rows.filter((row) => row.trackId === 'rot');
    expect(quatRows).toHaveLength(1);
    expect(quatRows[0]?.kind).toBe('track');
    expect(quatRows[0]?.part).toBeUndefined();
  });

  it('expands a quaternion into Euler curves, never channels', () => {
    const rows = buildRows(createSampleClip(), new Set(), 'curves');
    const quatRows = rows.filter((row) => row.trackId === 'rot' && row.kind === 'curve');
    expect(quatRows.map((row) => row.label)).toEqual(['Euler X', 'Euler Y', 'Euler Z']);
    expect(quatRows.every((row) => row.quat)).toBe(true);
    expect(rows.some((row) => row.trackId === 'rot' && row.label === 'W')).toBe(false);
  });

  it('expands a whole color into components and leaves scalar channels as one row', () => {
    const rows = buildRows(createSampleClip(), new Set(), 'curves');
    expect(rows.filter((row) => row.trackId === 'tint' && row.kind === 'curve').map((row) => row.label)).toEqual(['R', 'G', 'B', 'A']);
    expect(rows.filter((row) => row.trackId === 'pos-x')).toHaveLength(1);
  });

  it('does not split a quat that was stored with a channel', () => {
    const clip = createSampleClip();
    const track = rot(clip);
    track.target = { ...track.target, channel: 0 };
    track.keys = [{ t: 0, v: 0, interp: 'step' }];
    const rows = buildRows(clip, new Set(), 'curves').filter((row) => row.trackId === 'rot');
    expect(rows.map((row) => row.kind)).toEqual(['track']);
  });
});
