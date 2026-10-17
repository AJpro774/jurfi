import { checkBudgets, DEFAULT_BUDGETS } from './budgets';
import type { BudgetBreach, HeapGrowth, PerfBudgets, PerfDump, PerfFrame } from './types';
import { RING_SIZE, SCHEMA_VERSION } from './types';

export interface ProfilerOptions {
  /** Max distinct systems (typed-array stride). Default 32. */
  maxSystems?: number;
  now?: () => number;
  budgets?: Partial<PerfBudgets>;
  /** If set, also dispatches a CustomEvent('perf:frame', {detail}) on it (allocates; for the editor overlay). */
  target?: EventTarget;
  /** Supplies GPU ms for the last finished frame (e.g. () => gpuTimer.lastMs). */
  gpuSource?: () => number | null;
  /** Returns used heap bytes, if available (default: Chrome performance.memory). */
  heapSource?: () => number | null;
}

type FrameListener = (frame: PerfFrame) => void;

/**
 * Per-frame profiler. Hot-path methods (beginFrame/begin/end/endFrame) do not allocate once
 * systems are registered. Frames are stored in typed-array ring buffers (last 600).
 */
export class Profiler {
  readonly capacity = RING_SIZE;
  readonly budgets: PerfBudgets;
  private readonly maxSystems: number;
  private readonly now: () => number;
  private readonly cpu = new Float32Array(RING_SIZE);
  private readonly gpu = new Float32Array(RING_SIZE).fill(NaN);
  private readonly sys: Float32Array;
  private readonly starts: Float64Array;
  private readonly acc: Float64Array;
  private readonly names: string[] = [];
  private readonly ids = new Map<string, number>();
  private head = 0; // next write slot
  private count = 0;
  private frameStart = 0;
  private listeners: FrameListener[] = [];
  private readonly frame: PerfFrame = { cpuMs: 0, gpuMs: null, systems: {} };
  private readonly target: EventTarget | undefined;
  private readonly gpuSource: (() => number | null) | undefined;
  private readonly heapSource: () => number | null;
  private heapFirst: { t: number; b: number } | null = null;
  private heapLast: { t: number; b: number } | null = null;

  constructor(opts: ProfilerOptions = {}) {
    this.maxSystems = opts.maxSystems ?? 32;
    this.now = opts.now ?? (() => performance.now());
    this.budgets = { ...DEFAULT_BUDGETS, ...opts.budgets };
    this.target = opts.target;
    this.gpuSource = opts.gpuSource;
    this.heapSource = opts.heapSource ?? defaultHeap;
    this.sys = new Float32Array(RING_SIZE * this.maxSystems);
    this.starts = new Float64Array(this.maxSystems);
    this.acc = new Float64Array(this.maxSystems);
  }

  /** Register a system once at setup and keep the id for begin/end. */
  register(name: string): number {
    let id = this.ids.get(name);
    if (id === undefined) {
      if (this.names.length >= this.maxSystems) throw new Error(`Profiler: more than ${this.maxSystems} systems`);
      id = this.names.length;
      this.names.push(name);
      this.ids.set(name, id);
      this.frame.systems[name] = 0;
    }
    return id;
  }

  beginFrame(): void {
    this.acc.fill(0);
    this.frameStart = this.now();
  }

  /** Start timing a system (mark). Accepts an id from register() or a name (map lookup, no alloc once registered). */
  begin(system: number | string): void {
    const id = typeof system === 'number' ? system : this.register(system);
    this.starts[id] = this.now();
  }

  /** Stop timing a system (measure); multiple begin/end pairs per frame accumulate. Returns the span in ms. */
  end(system: number | string): number {
    const id = typeof system === 'number' ? system : this.register(system);
    const d = this.now() - (this.starts[id] as number);
    this.acc[id] = (this.acc[id] as number) + d;
    return d;
  }

  /** Finish frame, store in ring, notify listeners. Returns the (reused) flat frame object. */
  endFrame(): PerfFrame {
    const cpuMs = this.now() - this.frameStart;
    const i = this.head;
    this.cpu[i] = cpuMs;
    const g = this.gpuSource ? this.gpuSource() : null;
    this.gpu[i] = g === null ? NaN : g;
    const base = i * this.maxSystems;
    const f = this.frame;
    f.cpuMs = cpuMs;
    f.gpuMs = g;
    for (let s = 0; s < this.names.length; s++) {
      const v = this.acc[s] as number;
      this.sys[base + s] = v;
      f.systems[this.names[s] as string] = v;
    }
    this.head = (i + 1) % RING_SIZE;
    if (this.count < RING_SIZE) this.count++;
    if ((this.head & 15) === 0) this.sampleHeap();
    const ls = this.listeners;
    for (let k = 0; k < ls.length; k++) (ls[k] as FrameListener)(f);
    if (this.target) this.target.dispatchEvent(new CustomEvent<PerfFrame>('perf:frame', { detail: f }));
    return f;
  }

  /** Subscribe to the `perf:frame` event. The frame object is reused; copy it if you keep it. */
  on(type: 'perf:frame', fn: FrameListener): () => void {
    void type;
    this.listeners = [...this.listeners, fn];
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  get frameCount(): number {
    return this.count;
  }

  private sampleHeap(): void {
    const b = this.heapSource();
    if (b === null) return;
    const s = { t: this.now(), b };
    this.heapFirst ??= s;
    this.heapLast = s;
  }

  heapGrowth(): HeapGrowth | null {
    if (!this.heapFirst || !this.heapLast || this.heapLast === this.heapFirst) return null;
    return { startBytes: this.heapFirst.b, endBytes: this.heapLast.b, seconds: (this.heapLast.t - this.heapFirst.t) / 1000 };
  }

  /** Oldest-to-newest dump (allocates; call on demand, not per frame). */
  dump(): PerfDump {
    const frames: PerfFrame[] = [];
    const start = this.count < RING_SIZE ? 0 : this.head;
    for (let n = 0; n < this.count; n++) {
      const i = (start + n) % RING_SIZE;
      const systems: Record<string, number> = {};
      for (let s = 0; s < this.names.length; s++) systems[this.names[s] as string] = round(this.sys[i * this.maxSystems + s] as number);
      const g = this.gpu[i] as number;
      frames.push({ cpuMs: round(this.cpu[i] as number), gpuMs: Number.isNaN(g) ? null : round(g), systems });
    }
    return { schemaVersion: SCHEMA_VERSION, frames, budgets: { ...this.budgets } };
  }

  toJSON(): PerfDump {
    return this.dump();
  }

  checkBudgets(): BudgetBreach[] {
    return checkBudgets(this.dump(), this.budgets, this.heapGrowth());
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.heapFirst = this.heapLast = null;
    this.gpu.fill(NaN);
  }
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function defaultHeap(): number | null {
  const m = (globalThis.performance as unknown as { memory?: { usedJSHeapSize: number } } | undefined)?.memory;
  return m ? m.usedJSHeapSize : null;
}
