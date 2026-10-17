import { describe, expect, it, vi } from 'vitest';
import { checkBudgets, DEFAULT_BUDGETS, GpuTimer, Profiler } from './index';
import type { PerfFrame } from './index';

function clock() {
  let t = 0;
  return { now: () => t, advance: (d: number) => { t += d; } };
}

describe('Profiler', () => {
  it('records systems and cpu time', () => {
    const c = clock();
    const p = new Profiler({ now: c.now, heapSource: () => null });
    const phys = p.register('physics');
    p.beginFrame();
    p.begin(phys); c.advance(2); p.end(phys);
    p.begin('render'); c.advance(3); p.end('render');
    p.endFrame();
    const d = p.dump();
    expect(d.schemaVersion).toBe(1);
    expect(d.frames).toEqual([{ cpuMs: 5, gpuMs: null, systems: { physics: 2, render: 3 } }]);
    expect(d.budgets).toEqual({ cpuFrameMs: 8, gpuFrameMs: 8, gcSpikeMs: 4, heapGrowthMBPerSec: 1 });
    expect(JSON.parse(JSON.stringify(p)).frames).toHaveLength(1);
  });

  it('keeps only the last 600 frames, oldest first', () => {
    const c = clock();
    const p = new Profiler({ now: c.now, heapSource: () => null });
    for (let i = 0; i < 700; i++) { p.beginFrame(); c.advance(i + 1); p.endFrame(); }
    const d = p.dump();
    expect(d.frames).toHaveLength(600);
    expect(d.frames[0]?.cpuMs).toBe(101);
    expect(d.frames[599]?.cpuMs).toBe(700);
  });

  it('emits perf:frame with flat shape, and on a target', () => {
    const c = clock();
    const target = new EventTarget();
    const p = new Profiler({ now: c.now, target, gpuSource: () => 1.5, heapSource: () => null });
    const fn = vi.fn();
    const ev = vi.fn();
    p.on('perf:frame', fn);
    target.addEventListener('perf:frame', ev);
    p.register('ai');
    p.beginFrame(); p.begin('ai'); c.advance(1); p.end('ai'); p.endFrame();
    expect(fn).toHaveBeenCalledWith({ cpuMs: 1, gpuMs: 1.5, systems: { ai: 1 } });
    expect(ev).toHaveBeenCalledTimes(1);
  });

  it('accumulates repeated spans and reports heap growth', () => {
    const c = clock();
    let heap = 0;
    const p = new Profiler({ now: c.now, heapSource: () => heap });
    for (let i = 0; i < 64; i++) {
      p.beginFrame();
      p.begin('a'); c.advance(1); p.end('a'); p.begin('a'); c.advance(1); p.end('a');
      p.endFrame();
      heap += 1024 * 1024;
      c.advance(14);
    }
    expect(p.dump().frames[0]?.systems.a).toBe(2);
    const g = p.heapGrowth();
    expect(g).not.toBeNull();
    expect(p.checkBudgets().some((b) => b.kind === 'heapGrowthMBPerSec')).toBe(true);
  });
});

describe('checkBudgets', () => {
  const frames: PerfFrame[] = [
    { cpuMs: 4, gpuMs: 4, systems: { a: 4 } },
    { cpuMs: 4, gpuMs: null, systems: { a: 4 } },
    { cpuMs: 12, gpuMs: 9, systems: { a: 2, b: 10 } },
  ];
  it('returns breaches', () => {
    const b = checkBudgets({ frames }, DEFAULT_BUDGETS);
    expect(b).toEqual([
      { kind: 'cpuFrameMs', value: 12, limit: 8, frameIndex: 2, system: 'b' },
      { kind: 'gpuFrameMs', value: 9, limit: 8, frameIndex: 2 },
      { kind: 'gcSpikeMs', value: 8, limit: 4, frameIndex: 2 },
    ]);
  });
  it('passes clean data', () => {
    expect(checkBudgets({ frames: frames.slice(0, 2) })).toEqual([]);
  });
});

describe('GpuTimer', () => {
  it('computes ms from timestamps', async () => {
    const data = new BigUint64Array([1_000_000n, 3_500_000n]).buffer;
    const buf = { mapAsync: async () => {}, getMappedRange: () => data, unmap: () => {} };
    const dev = { createQuerySet: () => ({}), createBuffer: () => buf, queue: { submit() {} } };
    const t = new GpuTimer(dev);
    const enc = { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() };
    expect(t.resolve(enc)).toBe(true);
    await t.readback();
    expect(t.lastMs).toBe(2.5);
    expect(t.timestampWrites.endOfPassWriteIndex).toBe(1);
  });
});
