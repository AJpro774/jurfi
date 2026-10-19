import '@jurfi/ui';
import { detectBackend } from '@jurfi/render';
import { Input, VirtualButton } from '@jurfi/input';
import { AudioEngine } from '@jurfi/audio';
import { Profiler, createClock, createRng, createTestClock } from '@jurfi/perf';
import { PongGame, W, H } from './game';

// Fixed step shared by both clocks: 1/60 s (the clock works in ms, the game in seconds).
const STEP_MS = 1000 / 60;
const STEP = STEP_MS / 1000;

// NOTE: samples must never import @jurfi/editor (export guard).
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
canvas.width = W; canvas.height = H;

// Up is y = -1 in the real Input API, which matches canvas y-down, so `move.y` drives the paddle directly.
const input = new Input({
  element: canvas,
  context: 'gameplay',
  preventDefaultKeys: true, // stop Space/arrows scrolling the page (all bound keys)
  actionMap: {
    version: 1,
    actions: {
      jump: {
        type: 'button',
        contexts: ['gameplay'],
        bindings: [
          { device: 'key', code: 'Space' },
          { device: 'key', code: 'Enter' },
          { device: 'touch', control: 'serve' },
        ],
      },
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
// A tap serves (client-pixel region over the canvas); the paddle follows the finger via input.pointer.
const touchServe = input.touch.addButton(new VirtualButton('serve', 0, 0, 0, 0));
function layoutTouch(): void {
  const r = canvas.getBoundingClientRect();
  touchServe.left = r.left; touchServe.top = r.top; touchServe.width = r.width; touchServe.height = r.height;
}
layoutTouch();
addEventListener('resize', layoutTouch);
addEventListener('orientationchange', layoutTouch);
new ResizeObserver(layoutTouch).observe(canvas); // canvas is CSS-scaled; keep the hit region on its client rect
// Touch dragging must not scroll/zoom the page (index.html also sets touch-action: none).
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// Muted by default under ?test=1 (AudioEngine checks the query string itself).
const audio = new AudioEngine({ muted: testMode });
// Test mode: time moves only via clock.advance(); otherwise a real-time fixed-step clock (backlog capped at 15 steps = 0.25 s).
const testClock = createTestClock(STEP_MS);
const clock = testMode ? testClock : createClock({ fixedStepMs: STEP_MS, maxCatchUp: 15 });
const perf = new Profiler({ now: () => (testMode ? clock.now() : performance.now()) });
const sysUpdate = perf.register('update');
const sysDraw = perf.register('draw');
const rng = createRng(testMode ? 1337 : Date.now());

// Two short synthesized blips via AudioEngine.playTone (muted by master bus under ?test=1).
const hitTone = (): void => { audio.playTone({ frequency: 440, duration: 0.06, type: 'square', volume: 0.5, bus: 'sfx' }); };
const scoreTone = (): void => { audio.playTone({ frequency: 220, duration: 0.15, type: 'sine', volume: 0.5, bus: 'sfx' }); };
if (!testMode) { audio.setBusVolume('master', 0.6); audio.setBusVolume('sfx', 1); }
const game = new PongGame(rng, {
  onHit: hitTone,
  onScore: scoreTone,
});
console.info('backend:', detectBackend(), testMode ? '(test mode)' : '');

const css = getComputedStyle(document.body);
const color = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
const bg = color('--surface-0', 'black');
const fg = color('--text-1', 'white');
const accent = color('--accent', 'gray');

function update(): void {
  input.update();
  const jump = input.action('jump').justPressed;
  const move = input.axis2('move').y; // up = -1, down = +1
  // Touch: paddle centre follows the finger (ny is element-relative 0..1, so it is independent of CSS scale; * H gives the 640x400 canvas y); otherwise keyboard axis only.
  const p = input.pointer;
  const target = p.active && p.source === 'touch' ? p.ny * H : null;
  game.step(STEP, move, target, jump);
}

function draw(): void {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  for (let y = 0; y < H; y += 20) ctx.fillRect(W / 2 - 1, y, 2, 10);
  ctx.fillStyle = fg;
  for (const r of [game.ball, game.player, game.ai]) ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.font = '32px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(game.score.ai), W / 2 - 50, 40);
  ctx.fillText(String(game.score.player), W / 2 + 50, 40);
  ctx.font = '16px system-ui, sans-serif';
  if (game.phase !== 'play') {
    ctx.fillText(game.phase === 'over' ? 'Game over - press Space or tap' : 'Press Space or tap to serve', W / 2, H - 20);
  }
}

// Real-time: fixed-step accumulator. Test mode: exactly one step per frame, no wall clock.
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
  (window as unknown as { __pong: unknown }).__pong = {
    game,
    clock,
    perf,
    /** Deterministically advance n steps (and redraw). */
    advance(n: number) { for (let i = 0; i < n; i++) { testClock.advance(1); update(); } draw(); },
    /** Serve. Resets the frame counters first so state after start()+advance(n) does not depend on how many rAF frames ran before the call. */
    start() { testClock.reset(); game.frame = 0; game.step(STEP, 0, null, true); },
  };
}
