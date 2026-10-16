import type { BusName } from './types';

/**
 * Pooled voice handle. Instances are reused: check `active` and `id` (play generation)
 * before touching a retained reference.
 */
export class Voice {
  active = false;
  /** Generation counter, incremented each time this slot is (re)used. */
  id = 0;
  priority = 0;
  startedAt = 0;
  assetId = '';
  bus: BusName = 'sfx';
  source: AudioBufferSourceNode | null = null;
  gain: GainNode | null = null;
  /** @internal */
  onStop: ((v: Voice) => void) | null = null;
  /** @internal */
  ctx: BaseAudioContext | null = null;

  setVolume(v: number): void {
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  setPitch(rate: number): void {
    if (this.source && this.ctx) this.source.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.01);
  }

  /** Stop now, or fade out over `fade` seconds then stop. */
  stop(fade = 0): void {
    if (!this.active || !this.source || !this.gain || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (fade > 0) {
      const g = this.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + fade);
      this.source.stop(t + fade);
    } else {
      this.source.stop(t);
      this.release();
    }
  }

  /** @internal Frees the slot and disconnects nodes. */
  release(): void {
    if (!this.active) return;
    this.active = false;
    this.source?.disconnect();
    this.gain?.disconnect();
    if (this.source) this.source.onended = null;
    this.source = null;
    this.gain = null;
    this.onStop?.(this);
  }
}
