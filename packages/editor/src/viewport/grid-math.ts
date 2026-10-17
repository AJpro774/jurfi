import type { Vec3 } from '../math/vec';

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
