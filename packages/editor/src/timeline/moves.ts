import { addKey, moveKey, removeKey, sortKeys, type Clip, type Key, type KeyValue } from '@jurfi/anim';

export interface KeyMove {
  trackId: string;
  from: number;
  to: number;
  /** Replacement value. Omit to keep the current value. `moveKey` itself cannot change `v`. */
  v?: KeyValue;
}

function groupMoves(moves: readonly KeyMove[]): Map<string, KeyMove[]> {
  const byTrack = new Map<string, KeyMove[]>();
  for (const move of moves) {
    const list = byTrack.get(move.trackId) ?? [];
    list.push(move);
    byTrack.set(move.trackId, list);
  }
  return byTrack;
}

/** Why `applyKeyMoves` would refuse, or null when the batch is safe. */
export function describeMoveError(clip: Clip, moves: readonly KeyMove[]): string | null {
  for (const [trackId, list] of groupMoves(moves)) {
    const track = clip.tracks.find((item) => item.id === trackId);
    if (!track) return `unknown track "${trackId}"`;
    const froms = new Set<number>();
    const tos = new Set<number>();
    for (const move of list) {
      if (!Number.isFinite(move.to)) return `track "${trackId}" destination is not finite`;
      if (froms.has(move.from)) return `track "${trackId}" moves the key at ${move.from} twice`;
      froms.add(move.from);
      if (!track.keys.some((key) => key.t === move.from)) return `no key at t=${move.from} on track "${trackId}"`;
      if (tos.has(move.to)) return `two keys on "${trackId}" land on t=${move.to}`;
      tos.add(move.to);
      if (move.v !== undefined && track.type === 'quat') {
        if (track.target.channel !== undefined) return `quat track "${trackId}" cannot be edited per channel`;
        if (!Array.isArray(move.v) || move.v.length !== 4) return `quat track "${trackId}" keys must be a whole [x, y, z, w] value`;
      }
    }
    for (const key of track.keys) {
      if (froms.has(key.t)) continue;
      if (tos.has(key.t)) return `key already exists at t=${key.t} on track "${trackId}"`;
    }
  }
  return null;
}

function withValue(key: Key, value: KeyValue): Key {
  const next: Key = {
    t: key.t,
    v: Array.isArray(value) ? value.slice() : value,
    interp: key.interp,
  };
  if (key.inTan) next.inTan = { dt: key.inTan.dt, dv: key.inTan.dv };
  if (key.outTan) next.outTan = { dt: key.outTan.dt, dv: key.outTan.dv };
  return next;
}

/**
 * Move keys in time and optionally replace their values.
 * Time changes go through `moveKey` (parked off-range first so swaps succeed).
 * Value changes go through `addKey`, which replaces the key at that time.
 */
export function applyKeyMoves(clip: Clip, moves: readonly KeyMove[]): void {
  const error = describeMoveError(clip, moves);
  if (error) throw new Error(error);
  for (const [trackId, list] of groupMoves(moves)) {
    const active = list.filter((move) => move.from !== move.to || move.v !== undefined);
    let temp = -1;
    const parked: { temp: number; move: KeyMove }[] = [];
    for (const move of active) {
      if (move.from === move.to) {
        parked.push({ temp: move.from, move });
        continue;
      }
      moveKey(clip, trackId, move.from, temp);
      parked.push({ temp, move });
      temp -= 1;
    }
    for (const item of parked) {
      if (item.temp !== item.move.to) moveKey(clip, trackId, item.temp, item.move.to);
      if (item.move.v === undefined) continue;
      const track = clip.tracks.find((entry) => entry.id === trackId);
      const key = track?.keys.find((entry) => entry.t === item.move.to);
      if (!key) throw new Error(`no key at t=${item.move.to} on track "${trackId}"`);
      addKey(clip, trackId, withValue(key, item.move.v));
    }
  }
  sortKeys(clip);
}

export function removeKeys(clip: Clip, keys: readonly { trackId: string; t: number }[]): void {
  for (const key of keys) {
    if (!clip.tracks.some((track) => track.id === key.trackId)) continue;
    removeKey(clip, key.trackId, key.t);
  }
}
