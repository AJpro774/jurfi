import { sampleTrack, type Track } from '@jurfi/anim';
import { readComponent } from './values';

export interface CurvePoint {
  t: number;
  v: number;
}

/** Polyline of a curve row. Values come from `sampleTrack` (Euler degrees for whole quats). */
export function sampleCurve(track: Track, part: number | undefined, from: number, to: number, steps: number): CurvePoint[] {
  const count = Math.max(1, Math.floor(steps));
  const span = to - from;
  const points: CurvePoint[] = [];
  for (let i = 0; i <= count; i++) {
    const t = from + (span * i) / count;
    const sampled = sampleTrack(track, t);
    if (sampled === undefined) continue;
    const value = readComponent(track, { t, v: sampled, interp: 'linear' }, part);
    if (value === null || !Number.isFinite(value)) continue;
    points.push({ t, v: value });
  }
  return points;
}
