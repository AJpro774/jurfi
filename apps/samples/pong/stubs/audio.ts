// TODO(Audio): local stub. Replace with the real audio package once its API is final.
// Buses: master / sfx / music / ui.
export type BusName = 'master' | 'sfx' | 'music' | 'ui';

export class AudioStub {
  private ctx: AudioContext | null = null;
  private buses = new Map<BusName, GainNode>();
  private muted: boolean;

  constructor(muted: boolean) { this.muted = muted; }

  /** Lazily created (needs a user gesture). Never created when muted (?test=1). */
  private ensure(): AudioContext | null {
    if (this.muted || typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const master = this.ctx.createGain();
      master.connect(this.ctx.destination);
      this.buses.set('master', master);
      for (const n of ['sfx', 'music', 'ui'] as const) {
        const g = this.ctx.createGain();
        g.connect(master);
        this.buses.set(n, g);
      }
    }
    return this.ctx;
  }

  setBusVolume(bus: BusName, v: number): void {
    this.ensure();
    const g = this.buses.get(bus);
    if (g) g.gain.value = v;
  }

  beep(bus: Exclude<BusName, 'master'>, freq: number, ms = 60): void {
    const ctx = this.ensure();
    const out = this.buses.get(bus);
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(out);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  }
}
