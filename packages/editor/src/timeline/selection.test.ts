import { describe, expect, it } from 'vitest';
import { addRef, hasRef, toggleRef, uniqueKeyTimes, type KeyRef } from './selection';

const a: KeyRef = { trackId: 'pos-x', t: 0 };
const b: KeyRef = { trackId: 'pos-x', t: 1, part: 0 };
const sameKey: KeyRef = { trackId: 'pos-x', t: 1, part: 1 };

describe('selection', () => {
  it('toggles and adds key refs without duplicating a part', () => {
    expect(toggleRef([a], a)).toEqual([]);
    expect(toggleRef([a], b)).toEqual([a, b]);
    expect(addRef([b], b)).toEqual([b]);
    expect(hasRef([b], { trackId: 'pos-x', t: 1 })).toBe(false);
    expect(hasRef([b], b)).toBe(true);
  });

  it('collapses curve parts to one key when moving time', () => {
    expect(uniqueKeyTimes([b, sameKey, a])).toEqual([
      { trackId: 'pos-x', t: 1 },
      { trackId: 'pos-x', t: 0 },
    ]);
  });
});
