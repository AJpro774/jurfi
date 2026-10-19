import { describe, expect, it } from 'vitest';
import { buildGridSegments, gridBounds } from './grid-math';

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

  it('fades the 3D grid before the plane edge and inside the far plane', () => {
    const bounds = gridBounds(5000, 8, '3d');
    expect(bounds.fadeStart).toBeLessThan(bounds.fadeEnd);
    expect(bounds.fadeEnd).toBeLessThanOrEqual(bounds.extent);
    expect(bounds.extent + 8).toBeLessThan(5000 * 0.8);
  });

  it('shrinks the 3D grid as the camera approaches the far plane', () => {
    const close = gridBounds(100, 10, '3d');
    const distant = gridBounds(100, 70, '3d');
    expect(distant.extent).toBeLessThan(close.extent);
    expect(distant.extent + 70).toBeLessThanOrEqual(100);
  });

  it('covers a 2D view and fades outside it', () => {
    const bounds = gridBounds(500, 6, '2d');
    expect(bounds.extent).toBeGreaterThan(6);
    expect(bounds.fadeStart).toBeGreaterThan(6);
    expect(bounds.fadeEnd).toBeLessThanOrEqual(bounds.extent);
  });
});
