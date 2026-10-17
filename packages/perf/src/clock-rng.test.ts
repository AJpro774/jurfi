import { describe, expect, it } from 'vitest';
import { createClock, createRng, createTestClock } from './index';

describe('createClock', () => {
  it('steps at fixed rate with alpha', () => {
    const c = createClock({ fixedStepMs: 10 });
    c.tick(25);
    expect(c.step()).toBe(true);
    expect(c.step()).toBe(true);
    expect(c.step()).toBe(false);
    expect(c.frame).toBe(2);
    expect(c.now()).toBe(20);
    expect(c.alpha).toBeCloseTo(0.5);
  });
  it('caps catch-up', () => {
    const c = createClock({ fixedStepMs: 10, maxCatchUp: 3 });
    c.tick(10_000);
    let n = 0;
    while (c.step()) n++;
    expect(n).toBe(3);
  });
  it('reset', () => {
    const c = createClock({ fixedStepMs: 10 });
    c.tick(30); c.step(); c.reset();
    expect(c.frame).toBe(0);
    expect(c.alpha).toBe(0);
    expect(c.step()).toBe(false);
  });
  it('ignores bad ticks and validates options', () => {
    const c = createClock();
    c.tick(-5); c.tick(NaN);
    expect(c.step()).toBe(false);
    expect(() => createClock({ fixedStepMs: 0 })).toThrow();
  });
});

describe('createTestClock', () => {
  it('advance runs n steps deterministically', () => {
    const c = createTestClock(10);
    c.advance(100);
    expect(c.frame).toBe(100);
    expect(c.now()).toBe(1000);
    expect(c.alpha).toBe(0);
  });
  it('defaults to 60Hz and supports reset', () => {
    const c = createTestClock();
    c.advance(60);
    expect(c.now()).toBeCloseTo(1000);
    c.reset();
    expect(c.frame).toBe(0);
  });
});

describe('createRng', () => {
  const seq = (r: ReturnType<typeof createRng>, n = 20) => Array.from({ length: n }, () => r.next());
  it('is deterministic per seed (number and string)', () => {
    expect(seq(createRng(42))).toEqual(seq(createRng(42)));
    expect(seq(createRng('abc'))).toEqual(seq(createRng('abc')));
    expect(seq(createRng(1))).not.toEqual(seq(createRng(2)));
    expect(seq(createRng(1))).not.toEqual(seq(createRng('1')));
  });
  it('next in [0,1), int in [min,max), pick', () => {
    const r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const k = r.int(-2, 3);
      expect(k).toBeGreaterThanOrEqual(-2);
      expect(k).toBeLessThan(3);
      seen.add(k);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2]);
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    expect(() => r.pick([])).toThrow();
    expect(() => r.int(3, 3)).toThrow();
  });
  it('fork is independent, deterministic, and does not advance parent', () => {
    const a = createRng(5);
    const b = createRng(5);
    const fa = a.fork('x');
    expect(a.state).toBe(b.state);
    expect(seq(fa)).toEqual(seq(b.fork('x')));
    expect(seq(a.fork('x'))).not.toEqual(seq(a.fork('y')));
    const parent = seq(createRng(5));
    expect(seq(createRng(5).fork('x'))).not.toEqual(parent);
    // consuming the fork doesn't affect parent
    expect(seq(a)).toEqual(parent);
  });
  it('state get/set restores stream', () => {
    const r = createRng('save');
    seq(r, 10);
    const s = r.state;
    const expected = seq(r);
    r.state = s;
    expect(seq(r)).toEqual(expected);
    const other = createRng(0);
    other.state = s;
    expect(seq(other)).toEqual(expected);
    expect(() => { r.state = 'zz'; }).toThrow();
  });
  it('produces stable golden values for seed 12345', () => {
    const r = createRng(12345);
    expect([r.int(0, 1_000_000), r.int(0, 1_000_000), r.int(0, 1_000_000)]).toEqual([748659, 550809, 62929]);
  });
});
