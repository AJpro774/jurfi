import type { Rng } from '@jurfi/perf';
import { clamp } from '@jurfi/core';

/** Arena half-extent (world units, x/z plane; y is up). */
export const HALF = 5;
export const RADIUS = 0.4;
export const GEM_COUNT = 5;
const ACCEL = 14;
const DRAG = 1.2;
const RESTITUTION = 0.5;
const GEM_RADIUS = 0.35;

export interface Vec3 { x: number; y: number; z: number }
export interface GameEvents { onCollect(): void; onBump(): void }
export type Phase = 'ready' | 'play' | 'won';

/** Pure fixed-step marble simulation. No DOM or three.js: rolling is derived from velocity. */
export class MarbleGame {
  pos: Vec3 = { x: 0, y: RADIUS, z: 0 };
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  /** Accumulated roll angle about the x and z axes (radians), for rendering only. */
  roll = { x: 0, z: 0 };
  gems: { x: number; z: number; taken: boolean }[] = [];
  collected = 0;
  phase: Phase = 'ready';
  frame = 0;
  /** Steps spent in 'play'. */
  steps = 0;

  constructor(private rng: Rng, private events: GameEvents) { this.layout(); }

  private layout(): void {
    this.gems = [];
    for (let i = 0; i < GEM_COUNT; i++) {
      this.gems.push({ x: (this.rng.next() * 2 - 1) * (HALF - 1), z: (this.rng.next() * 2 - 1) * (HALF - 1), taken: false });
    }
  }

  /** ax/az: -1..1 push (az = -1 is "up"/away from camera). jump: start or restart. */
  step(dt: number, ax: number, az: number, jump: boolean): void {
    this.frame++;
    if (this.phase !== 'play') {
      if (jump) {
        if (this.phase === 'won') {
          this.pos = { x: 0, y: RADIUS, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
          this.collected = 0; this.steps = 0; this.layout();
        }
        this.phase = 'play';
      }
      return;
    }
    this.steps++;
    const v = this.vel, p = this.pos;
    v.x += ax * ACCEL * dt; v.z += az * ACCEL * dt;
    const damp = Math.max(0, 1 - DRAG * dt);
    v.x *= damp; v.z *= damp;
    p.x += v.x * dt; p.z += v.z * dt;
    const lim = HALF - RADIUS;
    if (Math.abs(p.x) > lim) { p.x = clamp(p.x, -lim, lim); v.x = -v.x * RESTITUTION; this.events.onBump(); }
    if (Math.abs(p.z) > lim) { p.z = clamp(p.z, -lim, lim); v.z = -v.z * RESTITUTION; this.events.onBump(); }
    // Rolling without slipping: angle += distance / radius (axis perpendicular to travel).
    this.roll.x += (v.z * dt) / RADIUS; this.roll.z -= (v.x * dt) / RADIUS;
    for (const g of this.gems) {
      if (g.taken) continue;
      const dx = g.x - p.x, dz = g.z - p.z, r = RADIUS + GEM_RADIUS;
      if (dx * dx + dz * dz < r * r) {
        g.taken = true; this.collected++; this.events.onCollect();
      }
    }
    if (this.collected >= GEM_COUNT) this.phase = 'won';
  }
}
