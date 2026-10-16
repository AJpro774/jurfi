// Fixed clock and seeded RNG for ?test=1 determinism.
// @jurfi/perf provides a Profiler only (no clock or RNG), so these stay local to the sample.
export interface Clock { readonly fixed: boolean; readonly dt: number; now(): number }

export const STEP = 1 / 60;

/** Fixed clock for ?test=1 (no wall time); real-time clock otherwise. Returns seconds. */
export function createClock(fixed: boolean): Clock & { tick(): void } {
  let t = 0;
  return {
    fixed,
    dt: STEP,
    now: () => (fixed ? t : performance.now() / 1000),
    tick: () => { t += STEP; },
  };
}

/** mulberry32 seeded PRNG. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
