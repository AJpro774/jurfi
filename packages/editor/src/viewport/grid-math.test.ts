import { describe, expect, it } from 'vitest';
import { buildGridSegments } from './grid-math';

describe('grid', () => {
  it('builds an XZ grid with both center lines marked as axes', () => {
    const segments = buildGridSegments(2, 1, 'xz');
    expect(segments).toHaveLength(10);
    const axes = segments.filter((segment) => segment.axis);
    expect(axes).toHaveLength(2);
    expect(axes).toContainEqual({ a: { x: -2, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 }, axis: true });
    expect(buildGridSegments(2, 0, 'xy')).toEqual([]);
  });

  it('lays a 2D grid on the XY plane', () => {
    const segments = buildGridSegments(1, 1, 'xy');
    expect(segments.every((segment) => segment.a.z === 0 && segment.b.z === 0)).toBe(true);
    expect(segments).toHaveLength(6);
  });
});
