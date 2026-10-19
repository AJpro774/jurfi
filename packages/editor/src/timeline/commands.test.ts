import { moveKey, validateClip } from '@jurfi/anim';
import { describe, expect, it } from 'vitest';
import { createUndoStack } from '../undo';
import {
  cloneClip,
  deleteKeys,
  insertKey,
  insertNumberTrack,
  readMeta,
  recordEdit,
  setKeyTangent,
  setKeysInterp,
  writeMeta,
} from './commands';
import { applyKeyMoves } from './moves';
import { createSampleClip } from './sample-clip';
import { quatToEulerDegrees } from './euler';
import { writeComponent } from './values';

function track(clip: ReturnType<typeof createSampleClip>, id: string) {
  const found = clip.tracks.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe('timeline commands', () => {
  it('undoes and redoes an inserted key', () => {
    const clip = createSampleClip();
    const stack = createUndoStack();
    recordEdit(stack, 'Add key', clip, () => insertKey(clip, 'pos-z', 1));
    expect(track(clip, 'pos-z').keys.map((key) => key.t)).toEqual([0, 1, 2]);
    expect(stack.undo()).toBe(true);
    expect(track(clip, 'pos-z').keys.map((key) => key.t)).toEqual([0, 2]);
    expect(stack.redo()).toBe(true);
    expect(track(clip, 'pos-z').keys.map((key) => key.t)).toContain(1);
    expect(validateClip(clip)).toEqual([]);
  });

  it('undoes a deletion', () => {
    const clip = createSampleClip();
    const stack = createUndoStack();
    recordEdit(stack, 'Delete', clip, () => deleteKeys(clip, [{ trackId: 'pos-y', t: 0.5 }]));
    expect(track(clip, 'pos-y').keys.some((key) => key.t === 0.5)).toBe(false);
    stack.undo();
    expect(track(clip, 'pos-y').keys.some((key) => key.t === 0.5)).toBe(true);
  });

  it('swaps key times through moveKey and restores them on undo', () => {
    const clip = createSampleClip();
    const stack = createUndoStack();
    const before = track(clip, 'pos-y').keys.map((key) => key.v);
    recordEdit(stack, 'Swap', clip, () => {
      applyKeyMoves(clip, [
        { trackId: 'pos-y', from: 0, to: 0.5 },
        { trackId: 'pos-y', from: 0.5, to: 0 },
      ]);
    });
    const y = track(clip, 'pos-y');
    expect(y.keys.find((key) => key.t === 0)?.v).toBe(before[1]);
    expect(y.keys.find((key) => key.t === 0.5)?.v).toBe(before[0]);
    stack.undo();
    expect(track(clip, 'pos-y').keys.find((key) => key.t === 0)?.v).toBe(before[0]);
    expect(validateClip(clip)).toEqual([]);
  });

  it('restores the clip when moveKey rejects an occupied time', () => {
    const clip = createSampleClip();
    const before = cloneClip(clip);
    const stack = createUndoStack();
    expect(() => recordEdit(stack, 'Collide', clip, () => moveKey(clip, 'pos-x', 0, 1))).toThrow(/already exists/);
    expect(clip).toEqual(before);
    expect(stack.canUndo()).toBe(false);
  });

  it('undoes interp and tangent edits', () => {
    const clip = createSampleClip();
    const stack = createUndoStack();
    recordEdit(stack, 'Interp', clip, () => setKeysInterp(clip, [{ trackId: 'pos-y', t: 0 }], 'step'));
    expect(track(clip, 'pos-y').keys[0]?.interp).toBe('step');
    stack.undo();
    expect(track(clip, 'pos-y').keys[0]?.interp).toBe('linear');

    recordEdit(stack, 'Tangent', clip, () => setKeyTangent(clip, 'pos-x', 0, 'out', { dt: 0.2, dv: 1 }));
    expect(track(clip, 'pos-x').keys[0]?.outTan).toEqual({ dt: 0.2, dv: 1 });
    expect(track(clip, 'pos-x').keys[0]?.interp).toBe('bezier');
    stack.undo();
    expect(track(clip, 'pos-x').keys[0]?.outTan).toEqual({ dt: 0.25, dv: 0.8 });
  });

  it('writes a quaternion as a whole key from one Euler axis', () => {
    const clip = createSampleClip();
    const stack = createUndoStack();
    const key = track(clip, 'rot').keys[0];
    if (!key || !Array.isArray(key.v)) throw new Error('missing quat key');
    const euler = quatToEulerDegrees(key.v);
    const next = writeComponent(track(clip, 'rot'), key, 2, (euler[2] ?? 0) + 15);
    expect(Array.isArray(next) && next).toHaveLength(4);
    if (!Array.isArray(next)) return;
    const edited = quatToEulerDegrees(next);
    expect(edited[2]).toBeCloseTo((euler[2] ?? 0) + 15, 4);
    expect(edited[0]).toBeCloseTo(euler[0] ?? 0, 4);
    expect(edited[1]).toBeCloseTo(euler[1] ?? 0, 4);
    recordEdit(stack, 'Rotate', clip, () => {
      applyKeyMoves(clip, [{ trackId: 'rot', from: key.t, to: key.t, v: next }]);
    });
    const stored = track(clip, 'rot').keys.find((item) => item.t === key.t)?.v;
    expect(stored).toEqual(next);
    expect(track(clip, 'rot').target.channel).toBeUndefined();
    stack.undo();
    expect(track(clip, 'rot').keys.find((item) => item.t === key.t)?.v).toEqual(key.v);
    expect(() => applyKeyMoves(clip, [{ trackId: 'rot', from: 0, to: 0, v: 1 }])).toThrow(/whole/);
  });

  it('refuses tangents on a quaternion track', () => {
    const clip = createSampleClip();
    expect(() => setKeyTangent(clip, 'rot', 0, 'out', { dt: 0.1, dv: 0.1 })).toThrow(/quat/);
  });

  it('undoes mute flags and an added track', () => {
    const clip = createSampleClip();
    const stack = createUndoStack();
    recordEdit(stack, 'Mute', clip, () => writeMeta(clip, { muted: ['pos-x'], locked: [] }));
    expect(readMeta(clip).muted).toEqual(['pos-x']);
    stack.undo();
    expect(readMeta(clip).muted).toEqual([]);

    recordEdit(stack, 'Add track', clip, () => insertNumberTrack(clip, 'hero'));
    expect(clip.tracks.some((item) => item.type === 'number' && item.target.prop.startsWith('value'))).toBe(true);
    stack.undo();
    expect(clip.tracks.some((item) => item.target.prop.startsWith('value'))).toBe(false);
    expect(validateClip(clip)).toEqual([]);
  });
});
