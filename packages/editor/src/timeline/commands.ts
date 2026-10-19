import {
  addKey,
  addTrack,
  sampleTrack,
  setInterp,
  type Clip,
  type Interp,
  type KeyValue,
  type Tangent,
  type Track,
} from '@jurfi/anim';
import type { UndoStack } from '../undo';
import { applyKeyMoves, removeKeys, type KeyMove } from './moves';
import { isWholeQuat } from './values';

export function cloneClip(clip: Clip): Clip {
  return structuredClone(clip);
}

/** Copy `source` onto `target` so holders of the clip object (the player) keep the reference. */
export function replaceClip(target: Clip, source: Clip): void {
  const copy = cloneClip(source);
  target.version = copy.version;
  target.id = copy.id;
  target.name = copy.name;
  target.duration = copy.duration;
  target.fps = copy.fps;
  target.loop = copy.loop;
  target.tracks = copy.tracks;
  if (copy.loopMode === undefined) delete target.loopMode;
  else target.loopMode = copy.loopMode;
  if (copy.events === undefined) delete target.events;
  else target.events = copy.events;
  if (copy.editor === undefined) delete target.editor;
  else target.editor = copy.editor;
}

/**
 * Apply `apply`, then push undo/redo that restore absolute snapshots.
 * `push` does not call `redo`; the edit is already on `clip` when this returns.
 * A throw from `apply` restores `clip` and does not push.
 */
export function recordEdit(undo: UndoStack, label: string, clip: Clip, apply: () => void, mergeKey?: string): void {
  const before = cloneClip(clip);
  try {
    apply();
  } catch (error) {
    replaceClip(clip, before);
    throw error;
  }
  const after = cloneClip(clip);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  undo.push({
    label,
    ...(mergeKey === undefined ? {} : { mergeKey }),
    undo() {
      replaceClip(clip, before);
    },
    redo() {
      replaceClip(clip, after);
    },
  });
}

function defaultValue(track: Track): KeyValue {
  if (isWholeQuat(track)) return [0, 0, 0, 1];
  if (track.type === 'bool') return false;
  if (track.type === 'string') return '';
  if (track.target.channel !== undefined || track.type === 'number') return 0;
  if (track.type === 'color') return [1, 1, 1, 1];
  const existing = track.keys[0]?.v;
  if (Array.isArray(existing)) return existing.map(() => 0);
  if (track.type === 'vec') return [0, 0, 0];
  return 0;
}

/** Insert a key at `time`, sampling the track when it already has keys. Existing times are left alone. */
export function insertKey(clip: Clip, trackId: string, time: number): void {
  const track = clip.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error(`unknown track "${trackId}"`);
  if (track.keys.some((key) => key.t === time)) return;
  const sampled = track.keys.length > 0 ? sampleTrack(track, time) : undefined;
  const value = sampled ?? defaultValue(track);
  addKey(clip, trackId, {
    t: time,
    v: value,
    interp: track.type === 'bool' || track.type === 'string' ? 'step' : 'linear',
  });
}

export function deleteKeys(clip: Clip, keys: readonly { trackId: string; t: number }[]): void {
  removeKeys(clip, keys);
}

export function moveKeys(clip: Clip, moves: readonly KeyMove[]): void {
  applyKeyMoves(clip, moves);
}

export function setKeysInterp(clip: Clip, keys: readonly { trackId: string; t: number }[], interp: Interp): void {
  for (const key of keys) setInterp(clip, key.trackId, key.t, interp);
}

export function setKeyTangent(clip: Clip, trackId: string, time: number, side: 'in' | 'out', tangent: Tangent): void {
  const track = clip.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error(`unknown track "${trackId}"`);
  if (track.type === 'quat') throw new Error(`quat track "${trackId}" tangents are not edited per channel`);
  const index = track.keys.findIndex((key) => key.t === time);
  const key = track.keys[index];
  if (!key) throw new Error(`no key at t=${time} on track "${trackId}"`);
  if (side === 'out') {
    setInterp(clip, trackId, time, 'bezier', { outTan: tangent });
    return;
  }
  setInterp(clip, trackId, time, key.interp, { inTan: tangent });
  const previous = track.keys[index - 1];
  if (previous && previous.interp === 'linear') setInterp(clip, trackId, previous.t, 'bezier');
}

export function insertEvent(clip: Clip, time: number, name: string): void {
  const events = clip.events ? clip.events.slice() : [];
  events.push({ t: time, name });
  events.sort((a, b) => a.t - b.t);
  clip.events = events;
}

export function deleteEvent(clip: Clip, index: number): void {
  if (!clip.events || clip.events[index] === undefined) return;
  const next = clip.events.filter((_, i) => i !== index);
  if (next.length === 0) delete clip.events;
  else clip.events = next;
}

export function patchEvent(clip: Clip, index: number, patch: { t?: number; name?: string }): number {
  const events = clip.events;
  const event = events?.[index];
  if (!event || !events) return index;
  if (patch.t !== undefined) event.t = patch.t;
  if (patch.name !== undefined) event.name = patch.name;
  events.sort((a, b) => a.t - b.t);
  const next = events.indexOf(event);
  return next < 0 ? index : next;
}

export interface TimelineMeta {
  muted: string[];
  locked: string[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function readMeta(clip: Clip): TimelineMeta {
  const bag = clip.editor?.timeline;
  if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) return { muted: [], locked: [] };
  const record = bag as { muted?: unknown; locked?: unknown };
  return { muted: stringList(record.muted), locked: stringList(record.locked) };
}

export function writeMeta(clip: Clip, meta: TimelineMeta): void {
  const editor = { ...(clip.editor ?? {}), timeline: { muted: [...meta.muted], locked: [...meta.locked] } };
  clip.editor = editor;
}

export function insertNumberTrack(clip: Clip, entity: string): string {
  let n = clip.tracks.length + 1;
  let id = `number-${n}`;
  while (clip.tracks.some((track) => track.id === id)) {
    n += 1;
    id = `number-${n}`;
  }
  addTrack(clip, {
    id,
    target: { entity, component: 'transform', prop: `value${n}`, channel: 0 },
    type: 'number',
    keys: [
      { t: 0, v: 0, interp: 'linear' },
      { t: clip.duration, v: 1, interp: 'linear' },
    ],
  });
  return id;
}
