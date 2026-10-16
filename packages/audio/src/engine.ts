import { SpatialEmitter } from './emitter';
import { MusicPlayer } from './music';
import type { AudioEngineOptions, BusName, ListenerTransform, PlayOptions, SpatialOptions } from './types';
import { BUS_NAMES } from './types';
import { Voice } from './voice';

/** True when the query string contains `test=1` (audio is muted in that mode). */
export function isTestMode(search: string | undefined = (globalThis as { location?: { search?: string } }).location?.search): boolean {
  if (!search) return false;
  return /(?:^|[?&])test=1(?:&|$)/.test(search);
}

const GESTURES = ['pointerdown', 'keydown', 'touchend', 'mousedown'] as const;

export class AudioEngine {
  readonly context: AudioContext;
  readonly music: MusicPlayer;
  readonly voices: Voice[];
  private readonly buses = {} as Record<BusName, GainNode>;
  private readonly busVolumes: Record<BusName, number> = { master: 1, sfx: 1, music: 1, ui: 1 };
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer>>();
  private muted: boolean;
  private readonly gestureTarget: EventTarget | undefined;
  private readonly onGesture = (): void => { void this.resume(); };
  private readonly fetchFn: NonNullable<AudioEngineOptions['fetch']>;
  private serial = 0;

  constructor(opts: AudioEngineOptions = {}) {
    this.context = opts.createContext ? opts.createContext() : new AudioContext();
    this.muted = opts.muted ?? isTestMode(opts.search);
    this.fetchFn = opts.fetch ?? ((u) => fetch(u));
    const ctx = this.context;
    for (const name of BUS_NAMES) this.buses[name] = ctx.createGain();
    this.buses.master.gain.value = this.muted ? 0 : 1;
    this.buses.master.connect(ctx.destination);
    for (const name of ['sfx', 'music', 'ui'] as const) this.buses[name].connect(this.buses.master);

    this.voices = Array.from({ length: opts.maxVoices ?? 32 }, () => {
      const v = new Voice();
      v.ctx = ctx;
      v.onStop = () => {};
      return v;
    });
    this.music = new MusicPlayer(this, opts.createMediaElement ?? (() => new Audio()));

    this.gestureTarget = opts.gestureTarget ?? (typeof globalThis.addEventListener === 'function' ? globalThis : undefined);
    if (ctx.state === 'suspended') {
      for (const g of GESTURES) this.gestureTarget?.addEventListener(g, this.onGesture, { passive: true });
    }
  }

  /** Resume the context (called automatically on first user gesture). */
  async resume(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.context.state === 'running') this.removeGestureListeners();
  }

  private removeGestureListeners(): void {
    for (const g of GESTURES) this.gestureTarget?.removeEventListener(g, this.onGesture);
  }

  bus(name: BusName): GainNode {
    return this.buses[name];
  }

  setBusVolume(name: BusName, v: number): void {
    this.busVolumes[name] = v;
    if (name === 'master' && this.muted) return;
    this.buses[name].gain.setTargetAtTime(v, this.context.currentTime, 0.01);
  }

  getBusVolume(name: BusName): number {
    return this.busVolumes[name];
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.buses.master.gain.setTargetAtTime(m ? 0 : this.busVolumes.master, this.context.currentTime, 0.01);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  // ---- buffers
  registerBuffer(id: string, buffer: AudioBuffer): void {
    this.buffers.set(id, buffer);
  }

  getBuffer(id: string): AudioBuffer | undefined {
    return this.buffers.get(id);
  }

  /** Fetch + decode once per asset id; concurrent calls share one promise. */
  loadBuffer(id: string, url: string): Promise<AudioBuffer> {
    const hit = this.buffers.get(id);
    if (hit) return Promise.resolve(hit);
    let p = this.loading.get(id);
    if (!p) {
      p = this.fetchFn(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => this.context.decodeAudioData(ab))
        .then((b) => { this.buffers.set(id, b); this.loading.delete(id); return b; }, (e) => { this.loading.delete(id); throw e; });
      this.loading.set(id, p);
    }
    return p;
  }

  releaseBuffer(id: string): void {
    this.buffers.delete(id);
  }

  // ---- listener
  /** Sync the AudioListener to a camera transform. Call once per frame; does not allocate. */
  syncListener(t: ListenerTransform): void {
    const l = this.context.listener;
    const { position: p, forward: f, up: u } = t;
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z;
    } else {
      const lg = l as unknown as { setPosition(...a: number[]): void; setOrientation(...a: number[]): void };
      lg.setPosition(p.x, p.y, p.z);
      lg.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  createEmitter(opts?: SpatialOptions): SpatialEmitter {
    return new SpatialEmitter(this, opts);
  }

  // ---- voices
  get activeVoices(): number {
    let n = 0;
    for (let i = 0; i < this.voices.length; i++) if ((this.voices[i] as Voice).active) n++;
    return n;
  }

  private acquire(priority: number): Voice | null {
    let victim: Voice | null = null;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i] as Voice;
      if (!v.active) return v;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.startedAt < victim.startedAt)) victim = v;
    }
    // Steal the lowest priority (oldest on ties), but never a higher-priority voice.
    if (victim && victim.priority <= priority) {
      victim.stop(0);
      return victim;
    }
    return null;
  }

  /**
   * Play a cached buffer. Returns null if the asset isn't loaded or every voice is
   * busy with higher-priority sounds. `destination` overrides the bus (used by emitters).
   */
  play(assetId: string, opts: PlayOptions = {}, destination?: AudioNode): Voice | null {
    const buffer = this.buffers.get(assetId);
    if (!buffer) return null;
    const priority = opts.priority ?? 0;
    const v = this.acquire(priority);
    if (!v) return null;
    const ctx = this.context;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    src.loop = opts.loop ?? false;
    src.playbackRate.value = opts.pitch ?? 1;
    const vol = opts.volume ?? 1;
    const fade = opts.fadeIn ?? 0;
    const t = ctx.currentTime;
    if (fade > 0) {
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + fade);
    } else gain.gain.setValueAtTime(vol, t);
    src.connect(gain);
    const bus = opts.bus ?? 'sfx';
    gain.connect(destination ?? this.buses[bus]);
    v.active = true;
    v.id = ++this.serial;
    v.priority = priority;
    v.startedAt = t;
    v.assetId = assetId;
    v.bus = bus;
    v.source = src;
    v.gain = gain;
    src.onended = () => { if (v.source === src) v.release(); };
    src.start(t);
    return v;
  }

  stopAll(fade = 0): void {
    for (const v of this.voices) v.stop(fade);
  }

  dispose(): void {
    this.removeGestureListeners();
    this.stopAll();
    this.music.dispose();
    void this.context.close();
  }
}
