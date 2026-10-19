import { clamp } from '@jurfi/core';
import type { ApplyFn, Clip, Key, KeyValue, SampledValue, Tangent, Track } from './types';

const QUAT_LERP_DOT = 0.9995;

function cloneValue(v: KeyValue): KeyValue {
  return Array.isArray(v) ? v.slice() : v;
}

function isDiscrete(track: Track, v: KeyValue): boolean {
  return track.type === 'bool' || track.type === 'string' || typeof v === 'boolean' || typeof v === 'string';
}

function isQuatValue(track: Track, v: KeyValue): v is number[] {
  return track.type === 'quat' && track.target.channel === undefined && Array.isArray(v);
}

function normalize4(v: readonly number[]): [number, number, number, number] {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  const w = v[3] ?? 0;
  const len = Math.hypot(x, y, z, w);
  if (len < 1e-12) return [0, 0, 0, 1];
  return [x / len, y / len, z / len, w / len];
}

/** Shortest-path quaternion slerp. Inputs need not be unit length. */
function slerp(a: readonly number[], b: readonly number[], t: number): number[] {
  const aN = normalize4(a);
  const bN = normalize4(b);
  let bx = bN[0];
  let by = bN[1];
  let bz = bN[2];
  let bw = bN[3];
  let dot = aN[0] * bx + aN[1] * by + aN[2] * bz + aN[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > QUAT_LERP_DOT) {
    return normalize4([
      aN[0] + (bx - aN[0]) * t,
      aN[1] + (by - aN[1]) * t,
      aN[2] + (bz - aN[2]) * t,
      aN[3] + (bw - aN[3]) * t,
    ]);
  }
  const theta = Math.acos(Math.min(1, dot));
  const s = Math.sin(theta);
  const w0 = Math.sin((1 - t) * theta) / s;
  const w1 = Math.sin(t * theta) / s;
  return [aN[0] * w0 + bx * w1, aN[1] * w0 + by * w1, aN[2] * w0 + bz * w1, aN[3] * w0 + bw * w1];
}

function evalBezier(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u;
  return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3;
}

function evalBezierDeriv(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u;
  return 3 * m * m * (p1 - p0) + 6 * m * u * (p2 - p1) + 3 * u * u * (p3 - p2);
}

/** Parameter `u` in [0, 1] such that the cubic through the time controls equals `target`. */
function solveBezierTime(p0: number, p1: number, p2: number, p3: number, target: number): number {
  const span = p3 - p0;
  if (Math.abs(span) < 1e-12) return 0;
  const uLinear = (target - p0) / span;
  const third = span / 3;
  if (Math.abs(p1 - (p0 + third)) < 1e-8 && Math.abs(p2 - (p0 + 2 * third)) < 1e-8) {
    return clamp(uLinear, 0, 1);
  }

  let u = clamp(uLinear, 0, 1);
  for (let i = 0; i < 12; i++) {
    const x = evalBezier(p0, p1, p2, p3, u) - target;
    if (Math.abs(x) < 1e-10) return u;
    const d = evalBezierDeriv(p0, p1, p2, p3, u);
    if (Math.abs(d) < 1e-12) break;
    const next = u - x / d;
    if (next < 0 || next > 1) break;
    u = next;
  }

  const x0 = evalBezier(p0, p1, p2, p3, 0);
  const x1 = evalBezier(p0, p1, p2, p3, 1);
  const increasing = x1 >= x0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const x = evalBezier(p0, p1, p2, p3, mid);
    if (Math.abs(x - target) < 1e-10) return mid;
    const tooLow = increasing ? x < target : x > target;
    if (tooLow) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function bezierComponent(
  t: number,
  t0: number,
  v0: number,
  t1: number,
  v1: number,
  outTan: Tangent | undefined,
  inTan: Tangent | undefined,
  u: number | undefined,
): { value: number; u: number } {
  const span = t1 - t0;
  const oDt = outTan?.dt ?? span / 3;
  const iDt = inTan?.dt ?? -span / 3;
  const solved = u ?? solveBezierTime(t0, t0 + oDt, t1 + iDt, t1, t);
  const oDv = outTan?.dv ?? (v1 - v0) / 3;
  const iDv = inTan?.dv ?? (v0 - v1) / 3;
  return { value: evalBezier(v0, v0 + oDv, v1 + iDv, v1, solved), u: solved };
}

function lerpComponents(a: readonly number[], b: readonly number[], u: number): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * u;
  return out;
}

function blend(track: Track, left: Key, right: Key, t: number): KeyValue {
  if (isDiscrete(track, left.v) || isDiscrete(track, right.v)) return cloneValue(left.v);
  const span = right.t - left.t;
  if (!(span > 0)) return cloneValue(left.v);
  const u = (t - left.t) / span;
  const interp = left.interp;

  if (interp === 'step') return cloneValue(left.v);

  const quat = isQuatValue(track, left.v) && isQuatValue(track, right.v);
  const customBezier = interp === 'bezier' && (left.outTan !== undefined || right.inTan !== undefined);

  if (interp === 'linear' || (interp === 'bezier' && !customBezier)) {
    if (typeof left.v === 'number' && typeof right.v === 'number') return left.v + (right.v - left.v) * u;
    if (quat && Array.isArray(left.v) && Array.isArray(right.v)) return slerp(left.v, right.v, u);
    if (Array.isArray(left.v) && Array.isArray(right.v)) return lerpComponents(left.v, right.v, u);
    return cloneValue(left.v);
  }

  if (typeof left.v === 'number' && typeof right.v === 'number') {
    return bezierComponent(t, left.t, left.v, right.t, right.v, left.outTan, right.inTan, undefined).value;
  }

  if (Array.isArray(left.v) && Array.isArray(right.v)) {
    const n = Math.max(left.v.length, right.v.length);
    const out = new Array<number>(n);
    let sharedU: number | undefined;
    for (let i = 0; i < n; i++) {
      const hit = bezierComponent(t, left.t, left.v[i] ?? 0, right.t, right.v[i] ?? 0, left.outTan, right.inTan, sharedU);
      sharedU = hit.u;
      out[i] = hit.value;
    }
    if (quat) return normalize4(out);
    return out;
  }

  return cloneValue(left.v);
}

/**
 * Sample one track at time `t` (seconds).
 * Times before the first key return the first value; times after the last key return the last.
 * The `interp` on a key controls the segment to the next key. Keys must be sorted by `t`.
 * An empty track returns `undefined`.
 */
export function sampleTrack(track: Track, t: number): KeyValue | undefined {
  const keys = track.keys;
  const first = keys[0];
  if (first === undefined) return undefined;
  if (!(t > first.t)) return cloneValue(first.v);

  let left = first;
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    if (key === undefined) continue;
    if (key.t <= t) {
      left = key;
      continue;
    }
    return blend(track, left, key, t);
  }
  return cloneValue(left.v);
}

function sampleAll(clip: Clip, t: number, applyFn?: ApplyFn): Map<string, SampledValue> {
  const out = new Map<string, SampledValue>();
  for (const track of clip.tracks) {
    const value = sampleTrack(track, t);
    if (value === undefined) continue;
    out.set(track.id, { target: track.target, value });
    applyFn?.(track.target, value);
  }
  return out;
}

/**
 * Sample every non-empty track at time `t`.
 * With `applyFn`, values are handed to the callback as `(target, value)` and nothing is returned.
 * Without it, returns a map keyed by track id.
 * Does not wrap or clamp to the clip duration — looping is `ClipPlayer`'s job. Each track clamps to its own keys.
 */
export function sampleClip(clip: Clip, t: number): Map<string, SampledValue>;
export function sampleClip(clip: Clip, t: number, applyFn: ApplyFn): void;
export function sampleClip(clip: Clip, t: number, applyFn?: ApplyFn): Map<string, SampledValue> | void {
  const sampled = sampleAll(clip, t, applyFn);
  if (applyFn) return;
  return sampled;
}
