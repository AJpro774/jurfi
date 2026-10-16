import { overlaps, type Aabb } from '@jurfi/physics';
import { clamp } from '@jurfi/core';

export const W = 640;
export const H = 400;
const PADDLE_SPEED = 300;
const AI_SPEED = 220;
const WIN_SCORE = 7;

export interface Paddle extends Aabb { vy: number }
export interface Ball extends Aabb { vx: number; vy: number }
export interface GameEvents { onHit(): void; onScore(): void }
export type Phase = 'serve' | 'play' | 'over';

export class PongGame {
  player: Paddle = { x: W - 24, y: H / 2 - 40, w: 8, h: 80, vy: 0 };
  ai: Paddle = { x: 16, y: H / 2 - 40, w: 8, h: 80, vy: 0 };
  ball: Ball = { x: W / 2, y: H / 2, w: 8, h: 8, vx: 0, vy: 0 };
  score = { player: 0, ai: 0 };
  phase: Phase = 'serve';
  frame = 0;

  constructor(private rng: () => number, private events: GameEvents) {}

  private serve(dir: number): void {
    this.ball.x = W / 2; this.ball.y = H / 2;
    this.ball.vx = 220 * dir;
    this.ball.vy = (this.rng() * 2 - 1) * 160;
    this.phase = 'play';
  }

  /** move: -1..1 vertical axis; target: touch target y in px or null. */
  step(dt: number, move: number, target: number | null, jump: boolean): void {
    this.frame++;
    if (this.phase !== 'play' && jump) {
      if (this.phase === 'over') this.score = { player: 0, ai: 0 };
      this.serve(this.rng() < 0.5 ? -1 : 1);
    }
    const p = this.player;
    if (target !== null) {
      const d = target - (p.y + p.h / 2);
      p.vy = clamp(d / dt, -PADDLE_SPEED, PADDLE_SPEED);
    } else p.vy = move * PADDLE_SPEED;
    p.y = clamp(p.y + p.vy * dt, 0, H - p.h);

    const a = this.ai;
    const ad = this.ball.y - (a.y + a.h / 2);
    a.y = clamp(a.y + clamp(ad, -AI_SPEED * dt, AI_SPEED * dt), 0, H - a.h);

    if (this.phase !== 'play') return;
    const b = this.ball;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < 0 || b.y > H - b.h) { b.y = clamp(b.y, 0, H - b.h); b.vy *= -1; }
    for (const pad of [p, a]) {
      if (overlaps(b, pad) && Math.sign(b.vx) === Math.sign(pad.x - b.x)) {
        const off = (b.y + b.h / 2 - (pad.y + pad.h / 2)) / (pad.h / 2);
        b.vx = -b.vx * 1.05;
        b.vy = off * 220;
        this.events.onHit();
      }
    }
    if (b.x < -b.w || b.x > W) {
      this.score[b.x < 0 ? 'player' : 'ai']++;
      this.events.onScore();
      this.phase = this.score.player >= WIN_SCORE || this.score.ai >= WIN_SCORE ? 'over' : 'serve';
      b.vx = b.vy = 0; b.x = W / 2; b.y = H / 2;
    }
  }
}
