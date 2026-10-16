/* Minimal structural WebGPU types so no @webgpu/types dependency is needed. */
export interface GpuDeviceLike {
  createQuerySet(d: { type: 'timestamp'; count: number }): unknown;
  createBuffer(d: { size: number; usage: number }): GpuBufferLike;
  queue: { submit(cmds: unknown[]): void };
}
export interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}
export interface GpuEncoderLike {
  resolveQuerySet(qs: unknown, first: number, count: number, dst: unknown, offset: number): void;
  copyBufferToBuffer(src: unknown, so: number, dst: unknown, d: number, size: number): void;
}
export interface GpuTimerOptions {
  /** Usage flag constants (default to the WebGPU spec values). */
  usage?: { QUERY_RESOLVE: number; COPY_SRC: number; COPY_DST: number; MAP_READ: number };
}

const DEFAULT_USAGE = { QUERY_RESOLVE: 0x200, COPY_SRC: 0x4, COPY_DST: 0x8, MAP_READ: 0x1 };

/**
 * Optional GPU timestamp queries (requires the 'timestamp-query' feature on the device).
 * Pass `timestampWrites` into the render/compute pass descriptor, call `resolve(encoder)`
 * before finishing the encoder, then `readback()` after submit. Results are one frame late.
 */
export class GpuTimer {
  /** Pre-allocated descriptor; reuse every frame. */
  readonly timestampWrites: { querySet: unknown; beginningOfPassWriteIndex: number; endOfPassWriteIndex: number };
  /** Latest resolved GPU time in ms, or null if none yet. */
  lastMs: number | null = null;
  private readonly querySet: unknown;
  private readonly resolveBuf: GpuBufferLike;
  private readonly readBuf: GpuBufferLike;
  private pending = false;

  constructor(private readonly device: GpuDeviceLike, opts: GpuTimerOptions = {}) {
    const u = opts.usage ?? DEFAULT_USAGE;
    this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    this.resolveBuf = device.createBuffer({ size: 16, usage: u.QUERY_RESOLVE | u.COPY_SRC });
    this.readBuf = device.createBuffer({ size: 16, usage: u.COPY_DST | u.MAP_READ });
    this.mapRead = u.MAP_READ;
    this.timestampWrites = { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }
  private readonly mapRead: number;

  /** Encode query resolution; skipped while a previous readback is still in flight. */
  resolve(encoder: GpuEncoderLike): boolean {
    if (this.pending) return false;
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuf, 0);
    encoder.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0, 16);
    return true;
  }

  /** Call after queue.submit for a frame in which resolve() returned true. */
  async readback(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    try {
      await this.readBuf.mapAsync(this.mapRead);
      const t = new BigUint64Array(this.readBuf.getMappedRange().slice(0));
      this.readBuf.unmap();
      this.lastMs = Number((t[1] as bigint) - (t[0] as bigint)) / 1e6;
    } finally {
      this.pending = false;
    }
  }
}
