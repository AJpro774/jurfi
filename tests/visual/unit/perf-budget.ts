/** Validates a @jurfi/perf profiler dump (schemaVersion 1) against budgets. Mirrors @jurfi/perf's checkBudgets semantics, plus a tolerance band. */
export interface Frame { cpuMs: number; gpuMs: number | null; systems: Record<string, number> }
export interface Budgets {
  cpuFrameMs: number;
  gpuFrameMs: number;
  /** gc-spike heuristic: cpuMs - median(cpuMs) above this is a WARNING only. */
  gcSpikeMs: number;
  heapGrowthMBPerSec: number;
}
export interface HeapGrowth { startBytes: number; endBytes: number; seconds: number }
export interface ProfilerDump { schemaVersion: 1; frames: Frame[]; budgets?: Partial<Budgets>; heap?: HeapGrowth | null }

export interface Options {
  /** Fractional overshoot of a budget that is only a warning (default 0.1). Use 0 for strict (matches @jurfi/perf). */
  tolerance?: number;
  /** Frames to skip as warmup (default 0). */
  skipFrames?: number;
  /** Percentile checked for cpu/gpu (default 0.95). Use 1 for strict per-frame max. */
  percentile?: number;
  /** Extra per-system budgets in ms (p-th percentile, same band). */
  systems?: Record<string, number>;
  /** Heap measurement; overrides dump.heap. Heap is asserted only if provided somewhere. */
  heap?: HeapGrowth | null;
}
export interface Result {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: { cpuP: number; gpuP: number | null; gpuFrames: number; frames: number; heapMBPerSec: number | null };
}

export const DEFAULT_BUDGETS: Budgets = { cpuFrameMs: 8, gpuFrameMs: 8, gcSpikeMs: 4, heapGrowthMBPerSec: 1 };

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}
export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export function validateShape(d: unknown): string[] {
  const e: string[] = [];
  const o = d as ProfilerDump;
  if (!o || typeof o !== 'object') return ['dump is not an object'];
  if (o.schemaVersion !== 1) e.push(`unsupported schemaVersion ${String(o.schemaVersion)}`);
  if (!Array.isArray(o.frames) || o.frames.length === 0) return [...e, 'frames must be a non-empty array'];
  o.frames.forEach((f, i) => {
    if (!isNum(f?.cpuMs)) e.push(`frames[${i}].cpuMs invalid`);
    if (f?.gpuMs !== null && !isNum(f?.gpuMs)) e.push(`frames[${i}].gpuMs must be a number or null`);
    if (!f?.systems || typeof f.systems !== 'object') e.push(`frames[${i}].systems invalid`);
    else for (const [k, v] of Object.entries(f.systems)) if (!isNum(v)) e.push(`frames[${i}].systems.${k} invalid`);
  });
  return e;
}

/**
 * cpu/gpu: p-th percentile <= budget passes; within budget*(1+tolerance) warns; beyond fails.
 * Any single cpu/gpu frame > 2x budget fails (spike guard). gpuMs === null frames are skipped.
 * gc spike (cpuMs > median + gcSpikeMs): warning only. Heap growth: asserted only when a measurement is provided.
 */
export function checkBudgets(dump: unknown, opts: Options = {}): Result {
  const { tolerance = 0.1, skipFrames = 0, percentile: p = 0.95 } = opts;
  const empty = (errors: string[]): Result => ({ ok: false, errors, warnings: [], stats: { cpuP: NaN, gpuP: null, gpuFrames: 0, frames: 0, heapMBPerSec: null } });
  const shapeErrors = validateShape(dump);
  if (shapeErrors.length) return empty(shapeErrors);
  const d = dump as ProfilerDump;
  const budgets: Budgets = { ...DEFAULT_BUDGETS, ...d.budgets };
  const frames = d.frames.slice(skipFrames);
  if (!frames.length) return empty(['no frames left after skipFrames']);
  const errors: string[] = [];
  const warnings: string[] = [];

  const judge = (label: string, values: number[], budget: number): number => {
    const v = percentile(values, p);
    const max = Math.max(...values);
    if (v > budget * (1 + tolerance)) errors.push(`${label} p${p * 100} ${v.toFixed(2)}ms > ${budget}ms (+${tolerance * 100}% band)`);
    else if (v > budget) warnings.push(`${label} p${p * 100} ${v.toFixed(2)}ms within tolerance band of ${budget}ms`);
    if (max > budget * 2) errors.push(`${label} spike ${max.toFixed(2)}ms > 2x budget ${budget}ms`);
    return v;
  };

  const cpu = frames.map((f) => f.cpuMs);
  const cpuP = judge('cpu', cpu, budgets.cpuFrameMs);
  const gpu = frames.map((f) => f.gpuMs).filter((x): x is number => x !== null);
  let gpuP: number | null = null;
  if (gpu.length) gpuP = judge('gpu', gpu, budgets.gpuFrameMs);
  else warnings.push('gpu: no gpuMs samples (all null), GPU budget skipped');

  const med = median(cpu);
  const spikes = cpu.filter((c) => c - med > budgets.gcSpikeMs).length;
  if (spikes) warnings.push(`gc-spike heuristic: ${spikes} frame(s) with cpuMs > median(${med.toFixed(2)}) + ${budgets.gcSpikeMs}ms`);

  for (const [name, b] of Object.entries(opts.systems ?? {})) judge(`system:${name}`, frames.map((f) => f.systems[name] ?? 0), b);

  const heap = opts.heap !== undefined ? opts.heap : d.heap;
  let heapMBPerSec: number | null = null;
  if (heap && heap.seconds > 0) {
    heapMBPerSec = (heap.endBytes - heap.startBytes) / 1048576 / heap.seconds;
    if (heapMBPerSec > budgets.heapGrowthMBPerSec) errors.push(`heap growth ${heapMBPerSec.toFixed(2)}MB/s > ${budgets.heapGrowthMBPerSec}MB/s`);
  }
  return { ok: errors.length === 0, errors, warnings, stats: { cpuP, gpuP, gpuFrames: gpu.length, frames: frames.length, heapMBPerSec } };
}
