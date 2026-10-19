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

## ECS binding

`applyClip(world, clip, t, options?)` samples the clip and writes each track through `@jurfi/core`.

- `target.entity` is an alias from `World.setAlias`, or a decimal packed entity id.
- `target.component` matches a registered component id, case-insensitively (`transform` → `Transform`).
- `target.prop` is a schema field. `target.channel` selects a lane (`position` channel `0` writes `position.x`; color lanes are `r`, `g`, `b`, `a`).
- Unknown entities, components, and fields return `ApplyWarning`s. They do not throw.
- Pass `recordHistory: false` during playback so samples do not fill the undo stack (`World.withoutHistory`).
- If the entity also has a JSON component under the track's component name, or under the schema id with a lowercase first letter, the write is copied there. The editor viewport reads that object (`transform.position.x`). Exported games can read the schema component directly.

```ts
player.onTime((t) => applyClip(world, clip, t, { recordHistory: false }));
```

## Blend trees

`BlendTree` is plain JSON (`version: 1`) for blend trees and state machines.

- Nodes: `clip`, `blend1D`, `blend2D`, `additive`, `mask`.
- Params: `float`, `int`, `bool`, `trigger`.
- States play a node. Transitions carry `conditions`, `duration` (seconds), and optional `exitTime` (seconds in the current state). `from: '*'` matches any state.
- `Pose` is `{ joints: { [name]: { position?, rotation?, scale? } } }`. Quaternions are `[x, y, z, w]`.
- `POSE_DATA_TYPE` is `'pose'`. The Node Graph accepts it as a data-pin type.
- `validateBlendTree` returns a list of problems.
- `evaluateBlendTree` samples `root`. `createMachine` / `stepMachine` advance states, crossfade, and report trigger ids the caller should clear.
- Additive position and scale are `base + weight * offset`. Additive rotation blends from the base quaternion toward the offset pose.
