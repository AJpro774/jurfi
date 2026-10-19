# @jurfi/anim

Clip runtime for Jurfi. The timeline editor and exported games share this data. Nothing in this package imports the editor or touches the DOM.

Time is seconds. Clips are plain JSON. Quaternions are `[x, y, z, w]`.

## Clip

- `Clip` — `version: 1`, `id`, `name`, `duration`, `fps`, `loop` (boolean), optional `loopMode` (`'loop'` default, or `'pingpong'`), `tracks`, optional `events`, optional `editor`.
- `Track` — `id`, `target: { entity, component, prop, channel? }`, optional `type` (`'number' | 'vec' | 'quat' | 'color' | 'bool' | 'string'`), `keys` sorted by `t`.
- Scalar-per-channel tracks (`target.channel` set, `v` a number) are the editor convention. Whole-vector tracks store `v` as `number[]`.
- `Key.interp` controls the segment from that key to the next: `'step' | 'linear' | 'bezier'`. Bool and string tracks always step.
- Bezier tangents are cubic control-point offsets `{ dt, dv }` relative to the key. Missing tangents match linear (slerp for quats). A Hermite slope `m` (value per second) over span `s` is outgoing `{ dt: s/3, dv: m*s/3 }` and incoming `{ dt: -s/3, dv: -m*s/3 }`.
- `loop: false` plays once. `loop: true` wraps, or bounces when `loopMode` is `'pingpong'`.

## Runtime

- `sampleTrack(track, t)` — clamps to the first and last keys.
- `sampleClip(clip, t, applyFn)` — calls `applyFn(target, value)` per non-empty track. `sampleClip(clip, t)` returns a `Map` keyed by track id (`{ target, value }`). Sampling does not wrap; `ClipPlayer` does.
- `ClipPlayer` — `play`, `pause`, `stop`, `seek(t, { fire? })`, `update(dt)`, `onEvent`, `onTime`. `speed` is signed. `seek` fires no events unless `fire: true`, and it jumps (no wrap). Events fire in crossing order, including across loop wraps and while reversing. Forward crossings are `(from, to]`; backward crossings are `[to, from)`.
- `addTrack`, `addKey`, `removeKey`, `moveKey`, `setInterp`, `sortKeys`, `validateClip`.
- `stripEditorData(clip)` — deep copy with `editor` removed, for export.
