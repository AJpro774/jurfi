import type { Clip, Interp, Key, Tangent, Track, TrackType } from './types';

const TRACK_TYPES = new Set<TrackType>(['number', 'vec', 'quat', 'color', 'bool', 'string']);
const INTERPS = new Set<Interp>(['step', 'linear', 'bezier']);

export interface TangentEdit {
  /** Pass `null` to clear a tangent. Omit to leave it unchanged. */
  inTan?: Tangent | null;
  outTan?: Tangent | null;
}

function isDiscrete(track: Track): boolean {
  return track.type === 'bool' || track.type === 'string';
}

function requireTrack(clip: Clip, trackId: string): Track {
  const track = clip.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`unknown track "${trackId}"`);
  return track;
}

function copyKey(track: Track, key: Key): Key {
  const next: Key = {
    t: key.t,
    v: Array.isArray(key.v) ? key.v.slice() : key.v,
    interp: isDiscrete(track) ? 'step' : key.interp,
  };
  if (key.inTan) next.inTan = { dt: key.inTan.dt, dv: key.inTan.dv };
  if (key.outTan) next.outTan = { dt: key.outTan.dt, dv: key.outTan.dv };
  return next;
}

/** Insert `track`, sorting its keys. Throws if `track.id` is already on the clip. */
export function addTrack(clip: Clip, track: Track): Clip {
  if (clip.tracks.some((t) => t.id === track.id)) throw new Error(`track id already exists: ${track.id}`);
  sortKeys(track);
  clip.tracks.push(track);
  return clip;
}

/**
 * Insert a key, keeping times unique and sorted.
 * A key at the same time replaces the existing one. Bool/string tracks store `interp: 'step'`.
 */
export function addKey(clip: Clip, trackId: string, key: Key): Clip {
  const track = requireTrack(clip, trackId);
  const next = copyKey(track, key);
  const idx = track.keys.findIndex((k) => k.t === next.t);
  if (idx >= 0) track.keys[idx] = next;
  else track.keys.push(next);
  sortKeys(track);
  return clip;
}

/** Remove the key at exactly `time`. Returns whether a key was removed. */
export function removeKey(clip: Clip, trackId: string, time: number): boolean {
  const track = requireTrack(clip, trackId);
  const idx = track.keys.findIndex((k) => k.t === time);
  if (idx < 0) return false;
  track.keys.splice(idx, 1);
  return true;
}

/** Move the key at `from` to `to` and re-sort. Throws if `from` is missing or `to` is occupied. */
export function moveKey(clip: Clip, trackId: string, from: number, to: number): Clip {
  const track = requireTrack(clip, trackId);
  const key = track.keys.find((k) => k.t === from);
  if (!key) throw new Error(`no key at t=${from} on track "${trackId}"`);
  if (from !== to && track.keys.some((k) => k.t === to)) {
    throw new Error(`key already exists at t=${to} on track "${trackId}"`);
  }
  key.t = to;
  sortKeys(track);
  return clip;
}

/** Set the segment interp (and optionally tangents) on the key at `time`. Discrete tracks stay on step. */
export function setInterp(clip: Clip, trackId: string, time: number, interp: Interp, tangents?: TangentEdit): Clip {
  const track = requireTrack(clip, trackId);
  const key = track.keys.find((k) => k.t === time);
  if (!key) throw new Error(`no key at t=${time} on track "${trackId}"`);
  key.interp = isDiscrete(track) ? 'step' : interp;
  if (tangents) {
    if (tangents.inTan === null) delete key.inTan;
    else if (tangents.inTan) key.inTan = { dt: tangents.inTan.dt, dv: tangents.inTan.dv };
    if (tangents.outTan === null) delete key.outTan;
    else if (tangents.outTan) key.outTan = { dt: tangents.outTan.dt, dv: tangents.outTan.dv };
  }
  return clip;
}

export function sortKeys(track: Track): Track;
export function sortKeys(clip: Clip): Clip;
export function sortKeys(target: Track | Clip): Track | Clip {
  if (isClip(target)) {
    for (const track of target.tracks) track.keys.sort(byTime);
    return target;
  }
  target.keys.sort(byTime);
  return target;
}

function byTime(a: Key, b: Key): number {
  return a.t - b.t;
}

function isClip(value: Track | Clip): value is Clip {
  return Array.isArray((value as Clip).tracks) && !Array.isArray((value as Track).keys);
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function tangentError(tan: Tangent | undefined): boolean {
  if (tan === undefined) return false;
  return !finite(tan.dt) || !finite(tan.dv);
}

function valueMatches(track: Track, key: Key): boolean {
  const type = track.type;
  const v = key.v;
  if (type === 'bool') return typeof v === 'boolean';
  if (type === 'string') return typeof v === 'string';
  const channel = track.target.channel;
  if (channel !== undefined) return typeof v === 'number' && Number.isFinite(v);
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'quat') return Array.isArray(v) && v.length === 4 && v.every((n) => finite(n));
  if (type === 'color') return Array.isArray(v) && (v.length === 3 || v.length === 4) && v.every((n) => finite(n));
  if (type === 'vec') return Array.isArray(v) && v.length >= 1 && v.every((n) => finite(n));
  if (type === undefined) {
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'boolean' || typeof v === 'string') return true;
    return Array.isArray(v) && v.length >= 1 && v.every((n) => finite(n));
  }
  return false;
}

/** Structural checks for editor saves. Returns a list of human-readable errors; empty means usable. */
export function validateClip(clip: Clip): string[] {
  const errors: string[] = [];
  if (clip.version !== 1) errors.push('version must be 1');
  if (!nonEmpty(clip.id)) errors.push('id must be a non-empty string');
  if (!nonEmpty(clip.name)) errors.push('name must be a non-empty string');
  if (!finite(clip.duration) || clip.duration < 0) errors.push('duration must be a finite number >= 0');
  if (!finite(clip.fps) || clip.fps <= 0) errors.push('fps must be a finite number > 0');
  if (typeof clip.loop !== 'boolean') errors.push('loop must be a boolean');
  if (clip.loopMode !== undefined && clip.loopMode !== 'loop' && clip.loopMode !== 'pingpong') {
    errors.push('loopMode must be "loop" or "pingpong"');
  }
  if (clip.editor !== undefined && (clip.editor === null || typeof clip.editor !== 'object' || Array.isArray(clip.editor))) {
    errors.push('editor must be a plain object');
  }
  if (!Array.isArray(clip.tracks)) {
    errors.push('tracks must be an array');
    return errors;
  }

  const seen = new Set<string>();
  for (const track of clip.tracks) {
    const id = nonEmpty(track.id) ? track.id : '';
    const label = id || '(missing id)';
    if (!id) errors.push('track id must be a non-empty string');
    else if (seen.has(id)) errors.push(`duplicate track id "${id}"`);
    else seen.add(id);

    const target = track.target;
    if (!target || typeof target !== 'object') {
      errors.push(`track "${label}" is missing a target`);
    } else {
      if (!nonEmpty(target.entity)) errors.push(`track "${label}" target.entity must be a non-empty string`);
      if (!nonEmpty(target.component)) errors.push(`track "${label}" target.component must be a non-empty string`);
      if (!nonEmpty(target.prop)) errors.push(`track "${label}" target.prop must be a non-empty string`);
      if (target.channel !== undefined && (!Number.isInteger(target.channel) || target.channel < 0)) {
        errors.push(`track "${label}" channel must be an integer >= 0`);
      }
    }
    if (track.type !== undefined && !TRACK_TYPES.has(track.type)) {
      errors.push(`track "${label}" type "${String(track.type)}" is invalid`);
    }
    if (!Array.isArray(track.keys)) {
      errors.push(`track "${label}" keys must be an array`);
      continue;
    }

    let prevT = Number.NEGATIVE_INFINITY;
    const times = new Set<number>();
    for (let i = 0; i < track.keys.length; i++) {
      const key = track.keys[i];
      if (!key) continue;
      if (!finite(key.t)) {
        errors.push(`track "${label}" key ${i} time is not finite`);
        continue;
      }
      if (finite(clip.duration) && (key.t < 0 || key.t > clip.duration)) {
        errors.push(`track "${label}" key time ${key.t} is outside [0, duration]`);
      }
      if (times.has(key.t)) errors.push(`track "${label}" duplicate key time ${key.t}`);
      times.add(key.t);
      if (key.t < prevT) errors.push(`track "${label}" keys are not sorted by time`);
      prevT = key.t;
      if (!INTERPS.has(key.interp)) errors.push(`track "${label}" key ${key.t} interp "${String(key.interp)}" is invalid`);
      if (isDiscrete(track) && key.interp !== 'step') {
        errors.push(`track "${label}" key ${key.t} must use step interpolation`);
      }
      if (!valueMatches(track, key)) {
        errors.push(`track "${label}" key ${key.t} value does not match type "${track.type ?? 'inferred'}"`);
      }
      if (tangentError(key.inTan) || tangentError(key.outTan)) {
        errors.push(`track "${label}" key ${key.t} tangent is invalid`);
      }
    }
  }

  if (clip.events !== undefined && !Array.isArray(clip.events)) {
    errors.push('events must be an array');
  } else if (clip.events) {
    for (let i = 0; i < clip.events.length; i++) {
      const event = clip.events[i];
      if (!event || !finite(event.t) || (finite(clip.duration) && (event.t < 0 || event.t > clip.duration))) {
        errors.push(`event ${i} time is outside [0, duration]`);
      }
      if (!event || !nonEmpty(event.name)) errors.push(`event ${i} name must be a non-empty string`);
    }
  }

  return errors;
}

/**
 * Deep copy of `clip` without the `editor` field, for export into a game build.
 * Does not mutate `clip`. Editor values are not cloned, so non-JSON editor bags are safe to drop.
 */
export function stripEditorData(clip: Clip): Clip {
  const copy = { ...clip };
  delete copy.editor;
  return structuredClone(copy);
}
