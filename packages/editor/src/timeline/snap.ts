/** Frame grid for the timeline. Frame spacing comes from `Clip.fps`. */

export function snapTime(time: number, fps: number, enabled: boolean): number {
  if (!enabled || !Number.isFinite(time) || !Number.isFinite(fps) || fps <= 0) return time;
  const frame = 1 / fps;
  return Math.round(time / frame) * frame;
}

export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.min(end, Math.max(0, time));
}

export function snapValue(value: number, step: number, enabled: boolean): number {
  if (!enabled || !Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Tick spacing covering `span` with about `target` divisions. */
export function niceStep(span: number, target = 8): number {
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(target) || target <= 0) return 1;
  const rough = span / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  if (!Number.isFinite(power) || power === 0) return 1;
  const error = rough / power;
  const nice = error >= 5 ? 5 : error >= 2 ? 2 : 1;
  return nice * power;
}
