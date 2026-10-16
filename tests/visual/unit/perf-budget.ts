export interface Frame { cpuMs: number; gpuMs: number; systems: Record<string, number> }
export interface Budgets { cpuMs: number; gpuMs: number; systems?: Record<string, number> }
export interface ProfilerDump { schemaVersion: 1; frames: Frame[]; budgets?: Partial<Budgets> }

export interface Options {
  /** Allowed fractional overshoot of a budget before it counts as a hard failure (default 0.1). */
  tolerance?: number;
  /** Frames to skip as warmup (default 0). */
  skipFrames?: number;
  /** Percentile checked against budget (default 0.95). Max frame is checked against budget*(1+tolerance)*2 as a spike guard. */
  percentile?: number;
}
export interface Result { ok: boolean; errors: string[]; warnings: string[]; stats: { cpuP: number; gpuP: number; frames: number } }

export const DEFAULT_BUDGETS: Budgets = { cpuMs: 8, gpuMs: 8 };

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}

function isNum(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }

export function validateShape(d: unknown): string[] {
  const e: string[] = [];
  const o = d as ProfilerDump;
  if (!o || typeof o !== 'object') return ['dump is not an object'];
  if (o.schemaVersion !== 1) e.push(`unsupported schemaVersion ${String(o.schemaVersion)}`);
  if (!Array.isArray(o.frames) || o.frames.length === 0) return [...e, 'frames must be a non-empty array'];
  o.frames.forEach((f, i) => {
    if (!isNum(f?.cpuMs)) e.push(`frames[${i}].cpuMs invalid`);
    if (!isNum(f?.gpuMs)) e.push(`frames[${i}].gpuMs invalid`);
    if (!f?.systems || typeof f.systems !== 'object') e.push(`frames[${i}].systems invalid`);
    else for (const [k, v] of Object.entries(f.systems)) if (!isNum(v)) e.push(`frames[${i}].systems.${k} invalid`);
  });
  return e;
}

/**
 * Pass: p-th percentile within budget. Warning: within budget*(1+tolerance) (the tolerance band).
 * Fail: above the band, or any single frame above 2x budget (spike), or per-system budgets exceeded (p-th percentile, same band).
 */
export function checkBudgets(dump: unknown, opts: Options = {}): Result {
  const { tolerance = 0.1, skipFrames = 0, percentile: p = 0.95 } = opts;
  const shapeErrors = validateShape(dump);
  if (shapeErrors.length) return { ok: false, errors: shapeErrors, warnings: [], stats: { cpuP: NaN, gpuP: NaN, frames: 0 } };
  const d = dump as ProfilerDump;
  const budgets: Budgets = { ...DEFAULT_BUDGETS, ...d.budgets };
  const frames = d.frames.slice(skipFrames);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!frames.length) return { ok: false, errors: ['no frames left after skipFrames'], warnings, stats: { cpuP: NaN, gpuP: NaN, frames: 0 } };

  const judge = (label: string, values: number[], budget: number): number => {
    const v = percentile(values, p);
    const max = Math.max(...values);
    if (v > budget * (1 + tolerance)) errors.push(`${label} p${p * 100} ${v.toFixed(2)}ms > ${budget}ms (+${tolerance * 100}% band)`);
    else if (v > budget) warnings.push(`${label} p${p * 100} ${v.toFixed(2)}ms within tolerance band of ${budget}ms`);
    if (max > budget * 2) errors.push(`${label} spike ${max.toFixed(2)}ms > 2x budget ${budget}ms`);
    return v;
  };
  const cpuP = judge('cpu', frames.map((f) => f.cpuMs), budgets.cpuMs);
  const gpuP = judge('gpu', frames.map((f) => f.gpuMs), budgets.gpuMs);
  for (const [name, b] of Object.entries(budgets.systems ?? {})) {
    judge(`system:${name}`, frames.map((f) => f.systems[name] ?? 0), b);
  }
  return { ok: errors.length === 0, errors, warnings, stats: { cpuP, gpuP, frames: frames.length } };
}
