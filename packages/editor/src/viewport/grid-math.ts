import type { Vec3 } from '../math/vec';

export interface GridBounds {
  /** Half-size of the grid plane, in world units. */
  extent: number;
  /** Planar distance where the fade begins. */
  fadeStart: number;
  /** Planar distance where the grid is fully transparent. Stays inside `extent`. */
  fadeEnd: number;
}

export interface GridSegment {
  a: Vec3;
  b: Vec3;
  /** True for the lines that pass through the origin on this plane. */
  axis: boolean;
}

export function buildGridSegments(extent: number, step: number, plane: 'xz' | 'xy'): GridSegment[] {
  if (!(step > 0) || !(extent > 0)) return [];
  const segments: GridSegment[] = [];
  const count = Math.floor(extent / step);
  for (let i = -count; i <= count; i += 1) {
    const p = i * step;
    const axis = i === 0;
    if (plane === 'xz') {
      segments.push({ a: { x: -extent, y: 0, z: p }, b: { x: extent, y: 0, z: p }, axis });
      segments.push({ a: { x: p, y: 0, z: -extent }, b: { x: p, y: 0, z: extent }, axis });
    } else {
      segments.push({ a: { x: -extent, y: p, z: 0 }, b: { x: extent, y: p, z: 0 }, axis });
      segments.push({ a: { x: p, y: -extent, z: 0 }, b: { x: p, y: extent, z: 0 }, axis });
    }
  }
  return segments;
}

/**
 * Size a grid plane so its edge is faded out and, in 3D, stays inside the far clip.
 * `viewSpan` is the orbit distance in 3D, or the visible half-extent in 2D.
 * The 2D grid lies on z = 0, which is inside the ortho near/far range; its quad is
 * bounded to the view so the edge stays off-screen.
 */
export function gridBounds(far: number, viewSpan: number, mode: '3d' | '2d'): GridBounds {
  const safeFar = far > 1 ? far : 1;
  const span = viewSpan > 0 ? viewSpan : 1;
  if (mode === '2d') {
    const extent = Math.max(span * 2.5, 1);
    const fadeEnd = extent * 0.92;
    const fadeStart = Math.min(span * 1.15, fadeEnd * 0.55);
    return { extent, fadeStart, fadeEnd };
  }
  const budget = Math.max(safeFar * 0.7 - span, 1);
  const extent = Math.min(Math.max(span * 10, 48), budget);
  const fadeEnd = Math.min(extent * 0.62, safeFar * 0.35);
  const fadeStart = Math.min(Math.max(span * 2, 8), fadeEnd * 0.45);
  return {
    extent,
    fadeStart: Math.min(fadeStart, fadeEnd * 0.75),
    fadeEnd: Math.min(fadeEnd, extent * 0.96),
  };
}
