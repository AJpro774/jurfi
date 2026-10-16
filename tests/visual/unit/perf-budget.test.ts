import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBudgets, percentile, validateShape } from './perf-budget';

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
  it('honours per-system budgets', () => {
    const d = load('perf-good.json');
    d.budgets = { systems: { physics: 0.25 } };
    const r = checkBudgets(d);
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
    expect(checkBudgets({ schemaVersion: 1, frames: [{ cpuMs: 1, gpuMs: 1 }] }).ok).toBe(false);
  });
  it('percentile', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBeNaN();
  });
});
