# Tutorial: Build a 3D marble roller (draft)

Source: `apps/samples/marble`. Run `pnpm --filter @jurfi/samples dev` and open `/marble/`.

## 1. Canvas and renderer

`index.html` is the Pong page: one `<canvas id="game" width="640" height="400">`, CSS-scaled (8:5) to fill the window, colors from `@jurfi/ui` tokens. `main.ts` `await`s `createRenderer(canvas, backend)` from `@jurfi/render`. `detectBackend()` picks `'webgpu'` or `'webgl2'`. `createRenderer` builds a three.js `WebGPURenderer` (`'webgl2'` sets `forceWebGL`) and waits for `renderer.init()` before returning, so the first `renderer.render()` is safe on both backends. The scene, camera, floor, and marble come from `@jurfi/render` helpers (`createScene`, `createPerspectiveCamera`, `createMesh`), which use `MeshStandardNodeMaterial`. Lights and the gem octahedra still use `three` directly; `@jurfi/render` does not re-export three. Under `?test=1` the sample forces `'webgl2'` so headless runs do not need a WebGPU adapter. Init is still awaited.

## 2. Game logic (`game.ts`)

`MarbleGame.step(dt, ax, az, jump)` is a pure fixed-step update (no DOM, no three). It uses `clamp` from `@jurfi/core`. `@jurfi/physics` currently exports only 2D `overlaps` and `Aabb`, and no Rapier, so the marble is integrated by hand: acceleration, drag, wall bounce, and roll angle (`distance / radius`) for rendering. Gem positions come from the seeded RNG.

## 3. Input (keyboard and touch, no device tilt)

```ts
import { Input } from '@jurfi/input';
const input = new Input({ element: canvas, context: 'gameplay', preventDefaultKeys: true, actionMap: { version: 1, actions: {
  jump: { type: 'button', contexts: ['gameplay'], bindings: [{ device: 'key', code: 'Space' }, { device: 'key', code: 'Enter' }] },
  move: { type: 'axis2d', contexts: ['gameplay'], bindings: [
    { device: 'key', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
    { device: 'key', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } ] },
} } });
// each fixed step
input.update();
input.action('jump').justPressed;
input.axis2('move'); // up is y = -1, which maps to world -z (away from the camera)
```

Touch: when `input.pointer.source === 'touch'` the marble is pushed toward the finger, using `(pointer.nx - 0.5)` and `(pointer.ny - 0.5)` (element-relative, so correct at any CSS scale). Any touch starts the game from the ready screen.

## 4. Audio, loop and profiling

`AudioEngine.playTone({ frequency, duration, type, volume, bus: 'sfx' })` plays the gem and bump blips; `new AudioEngine({ muted: true })` under `?test=1`. A `Profiler` from `@jurfi/perf` times `update` and `draw`. The loop is the same 1/60 s accumulator as Pong; `clock.ts` is a copy of Pong's fixed clock and mulberry32 RNG.

## 5. Test mode

Open `/marble/?test=1`: WebGL2 backend, one step per frame, seed 1337, audio muted. `window.__marble.advance(n)` runs `n` steps (calling `input.update()` each) and redraws; `__marble.start()` begins play; `__marble.game` exposes the state. Call `start()` and `advance()` in one `page.evaluate` to avoid interleaving with the page's own animation frames.
