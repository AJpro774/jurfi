# @jurfi/input

See docs/api/input-audio-perf.md.

## Additions

- `new Input({ preventDefaultKeys })` – opt-in `string[] | boolean`; calls `preventDefault()` on keydown for the listed
  `KeyboardEvent.code`s, or for all bound keys when `true`. Off by default. `input.setPreventDefaultKeys(v)` at runtime.
- `input.pointer` / `input.mouse.pointer` / `input.touch.pointer`: absolute position, element-relative px (`x`,`y`) and normalized 0..1 (`nx`,`ny`).
- `input.touch.touches`: fixed pool of 10 `TouchPoint`s (`active`, `id`, `x`, `y`, `nx`, `ny`), `touchCount`, `getTouch(id)`. No per-frame allocation.
- `VirtualStick#setAbsolute(true, anchorX?, anchorY?)`: stick value measured from a fixed anchor instead of touch start.
