/**
 * Clip data shared with the timeline editor.
 * Plain JSON. Time is seconds. Quaternions are `[x, y, z, w]`.
 * This module has no editor or DOM dependencies.
 */

export type Interp = 'step' | 'linear' | 'bezier';

export type TrackType = 'number' | 'vec' | 'quat' | 'color' | 'bool' | 'string';

/** How a looping clip repeats. Ignored when `Clip.loop` is false. Default `'loop'`. */
export type LoopMode = 'loop' | 'pingpong';

/**
 * Cubic-bezier control-point offset relative to the owning key.
 * Outgoing control is `(key.t + dt, component + dv)`; incoming control is the same
 * with the next key's `inTan`. Hermite-compatible: a slope `m` in value-per-second
 * over a span `s` is `{ dt: s / 3, dv: m * s / 3 }` outgoing and
 * `{ dt: -s / 3, dv: -m * s / 3 }` incoming.
 */
export interface Tangent {
  dt: number;
  dv: number;
}

/**
 * Scalar channels store a number. Whole vectors, colors, and quats store `number[]`.
 * Bool and string tracks store boolean / string and always sample as step.
 */
export type KeyValue = number | number[] | boolean | string;

export interface Key {
  /** Seconds. */
  t: number;
  v: KeyValue;
  /**
   * Interpolation for the segment from this key to the next.
   * Bool and string tracks are always step, regardless of this field.
   */
  interp: Interp;
  inTan?: Tangent;
  outTan?: Tangent;
}

export interface TrackTarget {
  entity: string;
  component: string;
  prop: string;
  /**
   * When set, the track drives one component (editor convention) and `v` is a number.
   * Omit it for a whole-vector / quat / color track (`v` is `number[]`).
   */
  channel?: number;
}

export interface Track {
  id: string;
  target: TrackTarget;
  type?: TrackType;
  /** Sorted by `t`. Duplicate times are invalid. */
  keys: Key[];
}

export interface ClipEvent {
  t: number;
  name: string;
  data?: unknown;
}

export interface Clip {
  version: 1;
  id: string;
  name: string;
  /** Seconds. */
  duration: number;
  fps: number;
  /** `false` plays once and clamps. `true` repeats using `loopMode` (default `'loop'`). */
  loop: boolean;
  loopMode?: LoopMode;
  tracks: Track[];
  events?: ClipEvent[];
  /** Editor-only bag. Removed by `stripEditorData` before export. */
  editor?: Record<string, unknown>;
}

export type ApplyFn = (target: TrackTarget, value: KeyValue) => void;

/** One sampled track. Maps from `sampleClip` are keyed by track id. */
export interface SampledValue {
  target: TrackTarget;
  value: KeyValue;
}
