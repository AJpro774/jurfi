import type { BudgetBreach, HeapGrowth, PerfBudgets, PerfDump, PerfFrame } from './types';

export const DEFAULT_BUDGETS: Readonly<PerfBudgets> = Object.freeze({
  cpuFrameMs: 8,
  gpuFrameMs: 8,
  gcSpikeMs: 4,
  heapGrowthMBPerSec: 1,
});

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function worstSystem(f: PerfFrame): string | undefined {
  let best: string | undefined;
  let bv = -1;
  for (const k in f.systems) {
    const v = f.systems[k] as number;
    if (v > bv) { bv = v; best = k; }
  }
  return best;
}

/**
 * Checks a dump against budgets and returns all breaches (empty array = pass).
 * - cpuFrameMs / gpuFrameMs: per-frame limit.
 * - gcSpikeMs (heuristic): a frame whose cpuMs exceeds the dump's median cpuMs by more than the limit.
 * - heapGrowthMBPerSec: needs the optional `heap` measurement (Profiler.heapGrowth()).
 */
export function checkBudgets(
  dump: Pick<PerfDump, 'frames'> & { budgets?: PerfBudgets },
  budgets: PerfBudgets = dump.budgets ?? DEFAULT_BUDGETS,
  heap?: HeapGrowth | null,
): BudgetBreach[] {
  const out: BudgetBreach[] = [];
  const med = median(dump.frames.map((f) => f.cpuMs));
  dump.frames.forEach((f, i) => {
    if (f.cpuMs > budgets.cpuFrameMs) {
      const system = worstSystem(f);
      out.push({ kind: 'cpuFrameMs', value: f.cpuMs, limit: budgets.cpuFrameMs, frameIndex: i, ...(system ? { system } : {}) });
    }
    if (f.gpuMs !== null && f.gpuMs > budgets.gpuFrameMs) {
      out.push({ kind: 'gpuFrameMs', value: f.gpuMs, limit: budgets.gpuFrameMs, frameIndex: i });
    }
    const spike = f.cpuMs - med;
    if (spike > budgets.gcSpikeMs) {
      out.push({ kind: 'gcSpikeMs', value: spike, limit: budgets.gcSpikeMs, frameIndex: i });
    }
  });
  if (heap && heap.seconds > 0) {
    const rate = (heap.endBytes - heap.startBytes) / 1048576 / heap.seconds;
    if (rate > budgets.heapGrowthMBPerSec) {
      out.push({ kind: 'heapGrowthMBPerSec', value: rate, limit: budgets.heapGrowthMBPerSec, frameIndex: -1 });
    }
  }
  return out;
}
