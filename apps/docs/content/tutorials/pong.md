# Tutorial: Build Pong (draft)

Source: `apps/samples/pong`. Run it with `pnpm --filter @jurfi/samples dev` and open `/pong/`.

## 1. Canvas and theme

`index.html` holds one `<canvas id="game">`. Colors are read from the `--jurfi-bg`, `--jurfi-fg` and `--jurfi-accent` tokens that `@jurfi/ui` provides.

## 2. Game logic (`game.ts`)

`PongGame.step(dt, move, target, jump)` is a pure fixed-timestep update. It uses `overlaps` from `@jurfi/physics` for paddle collisions and `clamp` from `@jurfi/core`. A simple AI drives the left paddle, and the first side to 7 wins.

## 3. Input

Input goes through a small facade:

```ts
input.action('jump').pressed  // Space / Enter / tap: serve or restart
input.axis2('move')           // W/S or Up/Down arrows
input.setContext('ui')        // swap contexts, e.g. while a menu is open
```

Touch: drag vertically anywhere on the canvas and the paddle follows your finger; a tap serves.

> **TODO:** the facade lives in `pong/stubs/input.ts` until the Input package API is final. Swap the import then.

## 4. Audio

Hits and scores play beeps on the `sfx` bus. The buses are `master`, `sfx`, `music` and `ui`. The stub is in `pong/stubs/audio.ts` (TODO: Audio package).

## 5. Fixed loop

`main.ts` runs a 1/60 s accumulator. Clock and seeded RNG are in `pong/stubs/perf.ts` (TODO: Perf package).

## 6. Test mode

Open `/pong/?test=1`:

- Fixed clock: exactly one 1/60 s step per frame, no wall time.
- Fixed random seed (1337).
- Audio muted: no `AudioContext` is created.
- `window.__pong.advance(n)` steps the game deterministically and `__pong.start()` serves.

Use this for visual and regression tests: the same steps always give the same frame.

## Next steps

Add a score screen with `@jurfi/ui`, or port the renderer from the 2D canvas to `@jurfi/render`.
