import { describe, expect, it } from 'vitest';
import { pickClosest, pickWithFallback, rayAabb } from './picking';

const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };

describe('picking', () => {
  it('hits an aabb in front of the ray and misses a box off to the side', () => {
    expect(rayAabb({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, box)).toBeCloseTo(4);
    expect(rayAabb({ x: 5, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, box)).toBeNull();
  });

  it('returns the closest id', () => {
    const id = pickClosest({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, [
      { id: 'far', aabb: { min: { x: -1, y: -1, z: 2 }, max: { x: 1, y: 1, z: 4 } } },
      { id: 'near', aabb: box },
    ]);
    expect(id).toBe('near');
    expect(pickClosest({ x: 0, y: 0, z: -5 }, { x: 0, y: 1, z: 0 }, [])).toBeNull();
  });

  it('prefers an id buffer and does not raycast when that picker misses', () => {
    let raycasts = 0;
    const raycast = () => {
      raycasts += 1;
      return 'ray';
    };
    expect(pickWithFallback({ pick: () => 'id' }, 1, 2, raycast)).toBe('id');
    expect(pickWithFallback({ pick: () => null }, 1, 2, raycast)).toBeNull();
    expect(raycasts).toBe(0);
    expect(pickWithFallback(null, 1, 2, raycast)).toBe('ray');
    expect(raycasts).toBe(1);
  });
});
