import '@jurfi/ui';
import { detectBackend } from '@jurfi/render';
import { PongGame, W, H } from './game';
import { InputStub } from './stubs/input';
import { AudioStub } from './stubs/audio';
import { createClock, createRng, STEP } from './stubs/perf';

// NOTE: samples must never import @jurfi/editor (export guard).
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
canvas.width = W; canvas.height = H;

const input = new InputStub(document.body, canvas);
const audio = new AudioStub(testMode); // muted in test mode
if (!testMode) { audio.setBusVolume('master', 0.6); audio.setBusVolume('sfx', 1); }
const clock = createClock(testMode);
const rng = createRng(testMode ? 1337 : (Date.now() & 0xffffffff));
const game = new PongGame(rng, {
  onHit: () => audio.beep('sfx', 440),
  onScore: () => audio.beep('sfx', 220, 150),
});
console.info('backend:', detectBackend(), testMode ? '(test mode)' : '');

const css = getComputedStyle(document.body);
const color = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
const bg = color('--jurfi-bg', 'black');
const fg = color('--jurfi-fg', 'white');
const accent = color('--jurfi-accent', 'gray');

function update(): void {
  input.setContext('game');
  const jump = input.action('jump').pressed;
  const move = input.axis2('move').y;
  const t = input.touchY === null ? null : input.touchY * H;
  game.step(STEP, move, t, jump);
  input.endFrame();
  clock.tick();
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
let acc = 0;
function frame(ts: number): void {
  if (testMode) update();
  else {
    acc += Math.min(0.25, (ts - last) / 1000);
    last = ts;
    while (acc >= STEP) { update(); acc -= STEP; }
  }
  draw();
  requestAnimationFrame(frame);
}
draw();
requestAnimationFrame((ts) => { last = ts; frame(ts); });

if (testMode) {
  (window as unknown as { __pong: unknown }).__pong = {
    game,
    clock,
    /** Deterministically advance n steps (and redraw). */
    advance(n: number) { for (let i = 0; i < n; i++) update(); draw(); },
    start() { game.step(STEP, 0, null, true); },
  };
}
