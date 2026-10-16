import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBudgets, median, percentile, validateShape } from './perf-budget';

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

describe('perf budget', () => {
  it('passes a healthy dump', () => {
    const r = checkBudgets(load('perf-good.json'));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('warns (but passes) inside the tolerance band', () => {
    const r = checkBudgets(load('perf-band.json'));
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('fails strictly with tolerance 0 / percentile 1', () => {
    expect(checkBudgets(load('perf-band.json'), { tolerance: 0, percentile: 1 }).ok).toBe(false);
  });
  it('fails over budget beyond the band', () => {
    const r = checkBudgets(load('perf-bad.json'));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/cpu/);
    expect(r.errors.join()).toMatch(/gpu/);
  });
  it('fails on single spike frame', () => {
    const d = load('perf-good.json');
    d.frames[3].cpuMs = 20;
    const r = checkBudgets(d);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/spike/);
  });
  it('treats gpuMs null as skipped, not a failure', () => {
    const r = checkBudgets(load('perf-gpu-null.json'));
    expect(r.ok).toBe(true);
    expect(r.stats.gpuP).toBeNull();
    expect(r.warnings.join()).toMatch(/gpu/);
  });
  it('mixed null/number gpu only judges numbers', () => {
    const d = load('perf-good.json');
    d.frames[0].gpuMs = null;
    const r = checkBudgets(d);
    expect(r.ok).toBe(true);
    expect(r.stats.gpuFrames).toBe(4);
  });
  it('gc spike is a warning only', () => {
    const r = checkBudgets(load('perf-gc-spike.json'), { tolerance: 0, percentile: 1 });
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/gc-spike/);
  });
  it('heap growth is asserted only if provided', () => {
    expect(checkBudgets(load('perf-good.json')).stats.heapMBPerSec).toBeNull();
    const bad = checkBudgets(load('perf-heap-bad.json'));
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toMatch(/heap/);
    expect(checkBudgets(load('perf-heap-ok.json')).ok).toBe(true);
    // explicit option overrides dump; null disables
    expect(checkBudgets(load('perf-heap-bad.json'), { heap: null }).ok).toBe(true);
  });
  it('honours optional per-system budgets', () => {
    const r = checkBudgets(load('perf-good.json'), { systems: { physics: 0.25 } });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/system:physics/);
  });
  it('skips warmup frames', () => {
    const d = load('perf-good.json');
    d.frames[0].cpuMs = 30;
    expect(checkBudgets(d).ok).toBe(false);
    expect(checkBudgets(d, { skipFrames: 1 }).ok).toBe(true);
  });
  it('rejects bad shapes', () => {
    expect(validateShape(null)).not.toEqual([]);
    expect(validateShape({ schemaVersion: 2, frames: [] }).join()).toMatch(/schemaVersion/);
    expect(checkBudgets({ schemaVersion: 1, frames: [{ cpuMs: -1, gpuMs: 1, systems: {} }] }).ok).toBe(false);
    expect(checkBudgets({ schemaVersion: 1, frames: [{ cpuMs: 1, systems: {} }] }).ok).toBe(false); // gpuMs missing (undefined) is not null
  });
  it('percentile/median', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBeNaN();
    expect(median([1, 3, 2, 10])).toBe(2.5);
  });
});

// Cross-check against the real @jurfi/perf checkBudgets (branch aip/input-audio-perf). No hard dependency:
// set JURFI_PERF_DIST to its dist/index.js; defaults to the sibling worktree; skipped with a message if absent.
const perfPath = process.env.JURFI_PERF_DIST ?? new URL('../../../../jurfi-aip/packages/perf/dist/index.js', import.meta.url).pathname;
type RealCheck = (d: unknown, b?: unknown, heap?: unknown) => { kind: string }[];
let real: RealCheck | undefined;
try { real = ((await import(/* @vite-ignore */ perfPath)) as { checkBudgets: RealCheck }).checkBudgets; } catch { /* not available */ }
if (!real) console.warn(`[perf cross-check] SKIPPED: @jurfi/perf not found at ${perfPath} (set JURFI_PERF_DIST)`);

describe.skipIf(!real)('cross-check vs real @jurfi/perf checkBudgets', () => {
  const fixtures = readdirSync(new URL('./fixtures/', import.meta.url)).filter((f) => f.startsWith('perf-') && f.endsWith('.json'));
  it.each(fixtures)('agrees on pass/fail for %s', (name) => {
    const d = load(name);
    const breaches = real!(d, d.budgets, d.heap ?? null);
    // gcSpikeMs breaches are warnings in our harness, so only hard kinds decide pass/fail.
    const realFail = breaches.some((b) => b.kind !== 'gcSpikeMs');
    const ours = checkBudgets(d, { tolerance: 0, percentile: 1 });
    expect(ours.ok, `ours: ${ours.errors.join('; ')} | real: ${JSON.stringify(breaches)}`).toBe(!realFail);
    // real gc-spike breaches must show up as our warnings
    if (breaches.some((b) => b.kind === 'gcSpikeMs')) expect(ours.warnings.join()).toMatch(/gc-spike/);
  });
});
