import type { Key, KeyValue, Track } from '@jurfi/anim';
import { eulerDegreesToQuat, quatToEulerDegrees } from './euler';

/** A quaternion stored as one `[x, y, z, w]` key. Channel tracks are not editable as quats. */
export function isWholeQuat(track: Track): boolean {
  return track.type === 'quat' && track.target.channel === undefined;
}

export function isDiscrete(track: Track): boolean {
  return track.type === 'bool' || track.type === 'string';
}

export function componentCount(track: Track): number {
  if (isWholeQuat(track)) return 3;
  if (isDiscrete(track) || track.target.channel !== undefined || track.type === 'number') return 1;
  for (const key of track.keys) {
    if (Array.isArray(key.v)) return key.v.length;
  }
  if (track.type === 'color') return 4;
  if (track.type === 'vec') return 3;
  return 1;
}

export function partLabel(track: Track, part: number): string {
  if (isWholeQuat(track)) return ['Euler X', 'Euler Y', 'Euler Z'][part] ?? `Euler ${part}`;
  if (track.type === 'color') return ['R', 'G', 'B', 'A'][part] ?? `c${part}`;
  if (track.target.channel !== undefined) {
    const channel = track.target.channel;
    return ['X', 'Y', 'Z', 'W'][channel] ?? `ch ${channel}`;
  }
  return ['X', 'Y', 'Z', 'W'][part] ?? `c${part}`;
}

/** Numeric curve value. Quat parts are Euler degrees of the whole key. */
export function readComponent(track: Track, key: Key, part: number | undefined): number | null {
  if (typeof key.v === 'boolean' || typeof key.v === 'string') return null;
  if (track.type === 'quat') {
    if (!isWholeQuat(track) || !Array.isArray(key.v) || key.v.length !== 4) return null;
    const euler = quatToEulerDegrees(key.v);
    return euler[part ?? 0] ?? 0;
  }
  if (typeof key.v === 'number') return key.v;
  if (Array.isArray(key.v)) return key.v[part ?? 0] ?? 0;
  return null;
}

/**
 * New key value after editing one curve row.
 * Quaternion edits return a full `[x, y, z, w]` and never a single channel.
 */
export function writeComponent(track: Track, key: Key, part: number | undefined, value: number): KeyValue | null {
  if (!Number.isFinite(value)) return null;
  if (track.type === 'quat') {
    if (!isWholeQuat(track) || !Array.isArray(key.v) || key.v.length !== 4) return null;
    const axis = part ?? 0;
    if (axis < 0 || axis > 2) return null;
    const euler = quatToEulerDegrees(key.v);
    const next: [number, number, number] = [euler[0], euler[1], euler[2]];
    next[axis] = value;
    return eulerDegreesToQuat(next);
  }
  if (typeof key.v === 'number') return value;
  if (Array.isArray(key.v)) {
    const copy = key.v.slice();
    const index = part ?? 0;
    if (index < 0 || index >= copy.length) return null;
    copy[index] = value;
    return copy;
  }
  return null;
}
