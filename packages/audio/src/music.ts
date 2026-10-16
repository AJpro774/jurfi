import type { AudioEngine } from './engine';

export interface MusicOptions { loop?: boolean; volume?: number; fadeIn?: number; pitch?: number }

/** Streaming music via MediaElementAudioSourceNode into the music bus. */
export class MusicPlayer {
  private el: HTMLMediaElement | null = null;
  private src: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly engine: AudioEngine, private readonly createElement: () => HTMLMediaElement) {}

  get playing(): boolean {
    return this.el !== null && !this.el.paused;
  }

  play(url: string, opts: MusicOptions = {}): void {
    this.teardown();
    const ctx = this.engine.context;
    const el = this.createElement();
    el.src = url;
    el.loop = opts.loop ?? true;
    el.crossOrigin = 'anonymous';
    el.playbackRate = opts.pitch ?? 1;
    const gain = ctx.createGain();
    const src = ctx.createMediaElementSource(el);
    src.connect(gain);
    gain.connect(this.engine.bus('music'));
    const vol = opts.volume ?? 1;
    const fade = opts.fadeIn ?? 0;
    if (fade > 0) {
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + fade);
    } else gain.gain.setValueAtTime(vol, ctx.currentTime);
    this.el = el; this.src = src; this.gain = gain;
    void el.play()?.catch(() => { /* autoplay blocked until gesture */ });
  }

  pause(): void { this.el?.pause(); }
  resume(): void { void this.el?.play()?.catch(() => {}); }

  setPitch(rate: number): void { if (this.el) this.el.playbackRate = rate; }

  setVolume(v: number): void {
    if (this.gain) this.gain.gain.setTargetAtTime(v, this.engine.context.currentTime, 0.02);
  }

  stop(fadeOut = 0): void {
    if (!this.el || !this.gain) return;
    if (fadeOut <= 0) { this.teardown(); return; }
    const ctx = this.engine.context;
    const g = this.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + fadeOut);
    this.stopTimer = setTimeout(() => this.teardown(), fadeOut * 1000);
  }

  private teardown(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.el) { this.el.pause(); this.el.removeAttribute('src'); }
    this.src?.disconnect();
    this.gain?.disconnect();
    this.el = null; this.src = null; this.gain = null;
  }

  dispose(): void { this.teardown(); }
}
