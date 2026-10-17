import { EcsError } from './errors';

export class WorldClock {
  frame = 0;
  elapsed = 0;
  delta = 0;
  scale = 1;

  tick(dt: number): void {
    if (typeof dt !== 'number' || !Number.isFinite(dt)) {
      throw new EcsError('invalid-value', 'delta time must be a finite number');
    }
    const scaled = dt * this.scale;
    this.delta = scaled;
    this.elapsed += scaled;
    this.frame += 1;
  }
}
