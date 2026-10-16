export const SCHEMA_VERSION = 1 as const;
export const RING_SIZE = 600;

export interface PerfBudgets {
  cpuFrameMs: number;
  gpuFrameMs: number;
  gcSpikeMs: number;
  heapGrowthMBPerSec: number;
}

/** Flat frame shape used both in dumps and the `perf:frame` event. gpuMs is null when unavailable. */
export interface PerfFrame {
  cpuMs: number;
  gpuMs: number | null;
  systems: Record<string, number>;
}

export interface PerfDump {
  schemaVersion: 1;
  frames: PerfFrame[];
  budgets: PerfBudgets;
}

export type BudgetKind = keyof PerfBudgets;

export interface BudgetBreach {
  kind: BudgetKind;
  value: number;
  limit: number;
  /** Index into dump.frames; -1 for whole-run metrics (heap growth). */
  frameIndex: number;
  /** System responsible (largest contributor) for cpu breaches, when known. */
  system?: string;
}

export interface HeapGrowth {
  startBytes: number;
  endBytes: number;
  seconds: number;
}
