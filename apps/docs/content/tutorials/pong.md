# Tutorial: Build Pong (draft)

Source: `apps/samples/pong`. Run it with `pnpm --filter @jurfi/samples dev` and open `/pong/`.

## 1. Canvas and theme

`index.html` holds one `<canvas id="game">`. Colors are read from the `--surface-0`, `--text-1` and `--accent` tokens that `@jurfi/ui` provides.

## 2. Game logic (`game.ts`)

`PongGame.step(dt, move, target, jump)` is a pure fixed-timestep update. It uses `overlaps` from `@jurfi/physics` for paddle collisions and `clamp` from `@jurfi/core`. A simple AI drives the left paddle, and the first side to 7 wins.

## 3. Input

Input comes from `@jurfi/input`. Define an action map, call `input.update()` once per frame, then query actions:

```ts
import { Input, VirtualButton } from '@jurfi/input';

const input = new Input({
  element: canvas,
  context: 'gameplay',
  preventDefaultKeys: true,
  actionMap: { version: 1, actions: {
    jump: { type: 'button', contexts: ['gameplay'], bindings: [
      { device: 'key', code: 'Space' }, { device: 'key', code: 'Enter' }, { device: 'touch', control: 'serve' } ] },
    move: { type: 'axis2d', contexts: ['gameplay'], bindings: [
      { device: 'key', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
      { device: 'key', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } ] },
  } },
});

// each fixed step:
input.update();
input.action('jump').justPressed  // Space / Enter / tap: serve or restart
input.axis2('move').y             // W/S or Up/Down; up is y = -1, down is y = +1
input.setContext('ui');           // swap contexts, e.g. while a menu is open (gameplay actions read as released)
```

Because up is `y = -1` and canvas `y` grows downward, `axis2('move').y` can drive the paddle directly.

Touch: a `VirtualButton('serve', ...)` covers the canvas (client pixels, re-laid-out on resize) so a tap serves. The paddle follows the finger using `input.pointer` (absolute position, refreshed in `input.update()`): when `pointer.source === 'touch'`, `pointer.ny * H` is passed as the `target` argument of `game.step`, and the paddle moves toward that y. (`VirtualStick.setAbsolute(true)` is an alternative that measures deflection from a fixed anchor.)

Browser defaults: `preventDefaultKeys: true` makes `Input` call `preventDefault()` on `keydown` for every key bound in the action map (Space, Enter, WASD, arrows), so the page does not scroll. Pass a `KeyboardEvent.code` array to limit it, or change it later with `input.setPreventDefaultKeys()`.

## 4. Audio

`@jurfi/audio` provides `AudioEngine` with the buses `master`, `sfx`, `music` and `ui`. Pong synthesizes its two blips with `audio.playTone({ frequency, duration, type, volume, bus: 'sfx' })`, with no buffers to register. Set levels with `audio.setBusVolume('master', 0.6)`. The engine resumes itself on the first pointer or key gesture. With `?test=1` it is muted (master bus gain 0), though the `AudioContext` and voices still exist.

## 5. Fixed loop and profiling

`main.ts` runs a 1/60 s accumulator. `@jurfi/perf` has no clock or RNG, so the fixed clock and seeded RNG live in `pong/clock.ts`. A `Profiler` from `@jurfi/perf` times the `update` and `draw` systems each frame (`perf.beginFrame()`, `perf.begin/end(system)`, `perf.endFrame()`); inspect it with `perf.dump()` or `perf.checkBudgets()`.

## 6. Test mode

Open `/pong/?test=1`:

- Fixed clock: exactly one 1/60 s step per frame, no wall time.
- Fixed random seed (1337).
- Audio muted: `AudioEngine` is created with `muted: true` (its master bus is silent).
- `window.__pong.advance(n)` steps the game deterministically (calling `input.update()` each step) and `__pong.start()` serves. `__pong.perf` exposes the profiler.

Use this for visual and regression tests: the same steps always give the same frame.

## Next steps

Add a score screen with `@jurfi/ui`, or port the renderer from the 2D canvas to `@jurfi/render`.
