import '@jurfi/ui';
import { AmbientLight, Color, DirectionalLight, Mesh, OctahedronGeometry } from 'three';
import { createMesh, createPerspectiveCamera, createRenderer, createScene, createStandardMaterial, detectBackend } from '@jurfi/render';
import { Input } from '@jurfi/input';
import { AudioEngine } from '@jurfi/audio';
import { Profiler, createClock, createRng, createTestClock } from '@jurfi/perf';
import { MarbleGame, HALF, RADIUS } from './game';

// Fixed step shared by both clocks: 1/60 s (the clock works in ms, the game in seconds).
const STEP_MS = 1000 / 60;
const STEP = STEP_MS / 1000;

// NOTE: samples must never import @jurfi/editor (export guard).
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const W = 640, H = 400;

// createRenderer awaits WebGPURenderer.init() on both backends. ?test=1 forces WebGL2
// (forceWebGL) so headless runs do not need a WebGPU adapter. Startup is an async
// function: a top-level await breaks the Vite 8 production build.
void main();

async function main(): Promise<void> {
  const backend = testMode ? 'webgl2' : detectBackend();
  const renderer = await createRenderer(canvas, backend);
  renderer.setSize(W, H, false); // internal 640x400; CSS scales the canvas to fill the window (same as Pong)
  console.info('backend:', backend, testMode ? '(test mode)' : '');

  const input = new Input({
    element: canvas,
    context: 'gameplay',
    preventDefaultKeys: true,
    actionMap: {
      version: 1,
      actions: {
        jump: { type: 'button', contexts: ['gameplay'], bindings: [{ device: 'key', code: 'Space' }, { device: 'key', code: 'Enter' }] },
        move: {
          type: 'axis2d',
          contexts: ['gameplay'],
          bindings: [
            { device: 'key', up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
            { device: 'key', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
          ],
        },
      },
    },
  });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const audio = new AudioEngine({ muted: testMode });
  if (!testMode) { audio.setBusVolume('master', 0.6); audio.setBusVolume('sfx', 1); }
  // Test mode: time moves only via clock.advance(); otherwise a real-time fixed-step clock (backlog capped at 15 steps = 0.25 s).
  const testClock = createTestClock(STEP_MS);
  const clock = testMode ? testClock : createClock({ fixedStepMs: STEP_MS, maxCatchUp: 15 });
  const perf = new Profiler({ now: () => (testMode ? clock.now() : performance.now()) });
  const sysUpdate = perf.register('update');
  const sysDraw = perf.register('draw');
  const rng = createRng(testMode ? 1337 : Date.now());
  const game = new MarbleGame(rng, {
    onCollect: () => { audio.playTone({ frequency: 660, duration: 0.08, type: 'sine', volume: 0.5, bus: 'sfx' }); },
    onBump: () => { audio.playTone({ frequency: 150, duration: 0.05, type: 'square', volume: 0.3, bus: 'sfx' }); },
  });

  const css = getComputedStyle(document.body);
  const color = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  const bg = color('--surface-0', 'black');
  const fg = color('--text-1', 'white');
  const accent = color('--accent', 'gray');

  // 2D overlay for text sits in the DOM so the WebGL canvas stays the single #game canvas.
  const hud = document.createElement('div');
  hud.style.cssText = `position:fixed;left:0;right:0;top:8px;text-align:center;font:16px system-ui,sans-serif;color:${fg};pointer-events:none`;
  document.body.append(hud);

  const scene = createScene({ background: bg });
  scene.add(new AmbientLight('white', 1.2));
  const sun = new DirectionalLight('white', 2.5);
  sun.position.set(4, 8, 3);
  scene.add(sun);
  const camera = createPerspectiveCamera({ fov: 50, aspect: W / H, near: 0.1, far: 100, position: [0, 11, 8], lookAt: [0, 0, 0] });
  const floor = createMesh({ kind: 'plane', width: HALF * 2, height: HALF * 2, color: new Color(accent).multiplyScalar(0.35) });
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const ball = createMesh({ kind: 'sphere', radius: RADIUS, widthSegments: 24, heightSegments: 16, color: fg, roughness: 0.3 });
  scene.add(ball);
  const gemMat = createStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.4 });
  const gemMeshes = game.gems.map((g) => { const m = new Mesh(new OctahedronGeometry(0.3), gemMat); m.position.set(g.x, 0.4, g.z); scene.add(m); return m; });

  function update(): void {
    input.update();
    const jump = input.action('jump').justPressed;
    const mv = input.axis2('move'); // up = -1 maps to world -z (away from camera)
    let ax = mv.x, az = mv.y;
    // Touch/mouse-drag: push toward the finger relative to the canvas centre (nx/ny are element-relative 0..1, scale independent).
    const p = input.pointer;
    if (p.active && p.source === 'touch') { ax = clamp1((p.nx - 0.5) * 3); az = clamp1((p.ny - 0.5) * 3); }
    // Touch: any active touch starts the game from the ready screen (restart after winning is Space/Enter).
    game.step(STEP, ax, az, jump || (game.phase === 'ready' && p.active && p.source === 'touch'));
  }
  function clamp1(v: number): number { return Math.max(-1, Math.min(1, v)); }

  function draw(): void {
    ball.position.set(game.pos.x, game.pos.y, game.pos.z);
    ball.rotation.set(game.roll.x, 0, game.roll.z);
    game.gems.forEach((g, i) => { gemMeshes[i]!.visible = !g.taken; gemMeshes[i]!.rotation.y = game.frame * 0.03; });
    renderer.render(scene, camera);
    hud.textContent = game.phase === 'ready' ? 'WASD / arrows / touch to roll - press Space or touch to start'
      : game.phase === 'won' ? `All gems in ${(game.steps * STEP).toFixed(1)}s - press Space to restart`
        : `Gems ${game.collected}/${game.gems.length}`;
  }

  let last = 0;
  function frame(ts: number): void {
    perf.beginFrame();
    perf.begin(sysUpdate);
    if (testMode) { testClock.advance(1); update(); }
    else {
      clock.tick(ts - last);
      last = ts;
      while (clock.step()) update();
    }
    perf.end(sysUpdate);
    perf.begin(sysDraw);
    draw();
    perf.end(sysDraw);
    perf.endFrame();
    requestAnimationFrame(frame);
  }
  draw();
  requestAnimationFrame((ts) => { last = ts; frame(ts); });

  if (testMode) {
    (window as unknown as { __marble: unknown }).__marble = {
      game,
      clock,
      perf,
      /** Deterministically advance n steps (and redraw). */
      advance(n: number) { for (let i = 0; i < n; i++) { testClock.advance(1); update(); } draw(); },
      /** Start play. Resets the frame counters first so state after start()+advance(n) does not depend on how many rAF frames ran before the call. */
      start() { testClock.reset(); game.frame = 0; game.step(STEP, 0, 0, true); },
    };
  }
}
