import type { Clip, ClipEvent, LoopMode } from './types';

const EPS = 1e-9;
const MAX_STEPS = 100_000;

export interface ClipPlayerOptions {
  time?: number;
  speed?: number;
  /** Overrides `clip.loop` for this player. */
  loop?: boolean;
  /** Overrides `clip.loopMode` for this player. Default `'loop'`. */
  loopMode?: LoopMode;
}

export interface SeekOptions {
  /** When true, fire events crossed by the jump. A seek never wraps. Default false. */
  fire?: boolean;
}

export type ClipEventListener = (event: ClipEvent) => void;
export type TimeListener = (time: number) => void;

interface OrderedEvent {
  t: number;
  name: string;
  data?: unknown;
  ord: number;
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || !(duration > 0)) return 0;
  if (time < 0) return 0;
  if (time > duration) return duration;
  return time;
}

function orderEvents(events: readonly ClipEvent[]): OrderedEvent[] {
  return events
    .map((event, ord) => {
      const next: OrderedEvent = { t: event.t, name: event.name, ord };
      if (event.data !== undefined) next.data = event.data;
      return next;
    })
    .sort((a, b) => a.t - b.t || a.ord - b.ord);
}

function publish(event: OrderedEvent): ClipEvent {
  return event.data === undefined ? { t: event.t, name: event.name } : { t: event.t, name: event.name, data: event.data };
}

/** Forward crossing: `(from, to]`, ascending. */
function forwardBetween(events: readonly OrderedEvent[], from: number, to: number, fired: ClipEvent[]): void {
  for (const event of events) {
    if (event.t > from && event.t <= to) fired.push(publish(event));
  }
}

/** Backward crossing: `[to, from)`, descending. */
function backwardBetween(events: readonly OrderedEvent[], from: number, to: number, fired: ClipEvent[]): void {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && event.t < from && event.t >= to) fired.push(publish(event));
  }
}

function atExact(events: readonly OrderedEvent[], t: number, fired: ClipEvent[], reverse: boolean): void {
  if (!reverse) {
    for (const event of events) if (event.t === t) fired.push(publish(event));
    return;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && event.t === t) fired.push(publish(event));
  }
}

interface AdvanceInput {
  time: number;
  playing: boolean;
  playDir: 1 | -1;
  speed: number;
  loop: boolean;
  loopMode: LoopMode;
  duration: number;
  events: readonly ClipEvent[];
  dt: number;
}

interface AdvanceResult {
  time: number;
  playing: boolean;
  playDir: 1 | -1;
  fired: ClipEvent[];
}

/**
 * Advance a playhead by `dt` seconds.
 * Events already under the playhead do not re-fire; they fire when the head arrives.
 * Loop wraps fire the events at the seam (`0` going forward, `duration` going backward).
 * Ping-pong flips direction at either end and does not fire that endpoint twice.
 */
export function advancePlayback(input: AdvanceInput): AdvanceResult {
  const fired: ClipEvent[] = [];
  const duration = input.duration;
  let time = clampTime(input.time, duration);
  let playing = input.playing;
  let playDir = input.playDir;
  if (!playing) return { time, playing, playDir, fired };
  if (!(input.dt > 0) || !Number.isFinite(input.dt) || input.speed === 0 || !Number.isFinite(input.speed)) {
    return { time, playing, playDir, fired };
  }
  if (!(duration > EPS)) {
    return { time: 0, playing: input.loop ? playing : false, playDir, fired };
  }

  const events = orderEvents(input.events);
  const pingpong = input.loop && input.loopMode === 'pingpong';
  const rate = Math.abs(input.speed);
  let remaining = input.dt;
  let guard = 0;

  while (remaining > EPS && playing && guard++ < MAX_STEPS) {
    const forward = Math.sign(input.speed) * playDir > 0;
    if (forward) {
      const dist = duration - time;
      if (dist <= EPS) {
        if (!input.loop) {
          time = duration;
          playing = false;
          break;
        }
        if (pingpong) {
          playDir = playDir === 1 ? -1 : 1;
          continue;
        }
        // Already on the seam (time === duration). Represent it as 0 so travel can proceed.
        // Crossing events fire when a real step arrives, not on this representation flip.
        time = 0;
        continue;
      }
      const need = dist / rate;
      if (remaining < need - EPS) {
        const next = time + rate * remaining;
        forwardBetween(events, time, next, fired);
        time = next;
        remaining = 0;
      } else {
        forwardBetween(events, time, duration, fired);
        remaining -= need;
        if (!input.loop) {
          time = duration;
          playing = false;
        } else if (pingpong) {
          time = duration;
          playDir = playDir === 1 ? -1 : 1;
        } else {
          time = 0;
          atExact(events, 0, fired, false);
        }
      }
    } else {
      const dist = time;
      if (dist <= EPS) {
        if (!input.loop) {
          time = 0;
          playing = false;
          break;
        }
        if (pingpong) {
          playDir = playDir === 1 ? -1 : 1;
          continue;
        }
        time = duration;
        continue;
      }
      const need = dist / rate;
      if (remaining < need - EPS) {
        const next = time - rate * remaining;
        backwardBetween(events, time, next, fired);
        time = next;
        remaining = 0;
      } else {
        backwardBetween(events, time, 0, fired);
        remaining -= need;
        if (!input.loop) {
          time = 0;
          playing = false;
        } else if (pingpong) {
          time = 0;
          playDir = playDir === 1 ? -1 : 1;
        } else {
          time = duration;
          atExact(events, duration, fired, true);
        }
      }
    }
  }

  return { time, playing, playDir, fired };
}

/**
 * Plays one clip. No editor or DOM dependencies.
 *
 * `loop === false` clamps at the ends and pauses (once).
 * `loop === true` uses `loopMode`: `'loop'` (default) wraps, `'pingpong'` bounces.
 * `speed` is signed seconds-per-second. Ping-pong keeps an internal direction that flips at each end.
 *
 * Event rules: the playhead fires an event when it arrives on it, in crossing order,
 * including across loop wraps and while playing backward. `seek` fires nothing unless `{ fire: true }`,
 * and a seek jumps — it does not simulate a wrap.
 */
export class ClipPlayer {
  clip: Clip;
  time: number;
  speed: number;
  playing = false;
  loop: boolean;
  loopMode: LoopMode;

  private playDir: 1 | -1 = 1;
  private readonly eventListeners = new Set<ClipEventListener>();
  private readonly timeListeners = new Set<TimeListener>();

  constructor(clip: Clip, options: ClipPlayerOptions = {}) {
    this.clip = clip;
    this.speed = options.speed ?? 1;
    this.loop = options.loop ?? clip.loop;
    this.loopMode = options.loopMode ?? clip.loopMode ?? 'loop';
    this.time = clampTime(options.time ?? 0, clip.duration);
  }

  /** Start playback. In once mode, a playhead sitting on the end it would travel into restarts at the other end. */
  play(): void {
    this.playing = true;
    const dir = Math.sign(this.speed) * this.playDir;
    const duration = this.clip.duration;
    if (!this.loop && duration > 0) {
      if (dir >= 0 && this.time >= duration) {
        this.time = 0;
        this.emitTime();
      } else if (dir < 0 && this.time <= 0) {
        this.time = duration;
        this.emitTime();
      }
    }
  }

  pause(): void {
    this.playing = false;
  }

  /** Pause and return to time 0. Does not fire events. Resets ping-pong direction. */
  stop(): void {
    this.playing = false;
    this.time = 0;
    this.playDir = 1;
    this.emitTime();
  }

  /**
   * Jump to `t`, clamped to `[0, duration]`.
   * Events between the previous time and the new time fire only when `fire` is true.
   */
  seek(t: number, options: SeekOptions = {}): ClipEvent[] {
    const from = clampTime(this.time, this.clip.duration);
    const to = clampTime(t, this.clip.duration);
    const fired = options.fire ? crossed(this.clip.events ?? [], from, to) : [];
    this.dispatchEvents(fired, to);
    return fired;
  }

  /** Advance `dt` seconds if playing. Returns the events fired during this step. */
  update(dt: number): ClipEvent[] {
    if (!this.playing) return [];
    const step = advancePlayback({
      time: this.time,
      playing: this.playing,
      playDir: this.playDir,
      speed: this.speed,
      loop: this.loop,
      loopMode: this.loopMode,
      duration: this.clip.duration,
      events: this.clip.events ?? [],
      dt,
    });
    this.playing = step.playing;
    this.playDir = step.playDir;
    this.dispatchEvents(step.fired, step.time);
    return step.fired;
  }

  /** Subscribe to events in crossing order. Returns an unsubscribe function. */
  onEvent(cb: ClipEventListener): () => void {
    this.eventListeners.add(cb);
    return () => {
      this.eventListeners.delete(cb);
    };
  }

  /** Subscribe to playhead time after `update`, `seek`, and `stop`. Returns an unsubscribe function. */
  onTime(cb: TimeListener): () => void {
    this.timeListeners.add(cb);
    return () => {
      this.timeListeners.delete(cb);
    };
  }

  /**
   * Deliver events in order. While a listener runs, `time` is the event time
   * (the crossing). `time` is then the final playhead time before `onTime`.
   */
  private dispatchEvents(events: readonly ClipEvent[], finalTime: number): void {
    if (events.length > 0 && this.eventListeners.size > 0) {
      const listeners = [...this.eventListeners];
      const duration = this.clip.duration;
      let hold = false;
      try {
        for (const event of events) {
          const atEvent = clampTime(event.t, duration);
          this.time = atEvent;
          for (const listener of listeners) listener(event);
          // seek/stop from a listener sticks. Later events in this step are skipped.
          if (this.time !== atEvent) {
            hold = true;
            return;
          }
        }
      } finally {
        if (!hold) this.time = finalTime;
      }
    } else {
      this.time = finalTime;
    }
    this.emitTime();
  }

  private emitTime(): void {
    if (this.timeListeners.size === 0) return;
    const listeners = [...this.timeListeners];
    const time = this.time;
    for (const listener of listeners) listener(time);
  }
}

function crossed(events: readonly ClipEvent[], from: number, to: number): ClipEvent[] {
  const ordered = orderEvents(events);
  const fired: ClipEvent[] = [];
  if (to > from) forwardBetween(ordered, from, to, fired);
  else if (to < from) backwardBetween(ordered, from, to, fired);
  return fired;
}
