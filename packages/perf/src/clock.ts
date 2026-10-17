/** Fixed-step clock with interpolation alpha. No dependency on other packages. */
export interface Clock {
  /** Simulated time in ms (frame * fixedStepMs). Advances only via step(). */
  now(): number;
  /** Add `realMs` of elapsed real time (a delta, not a timestamp). Accumulator is capped at maxCatchUp steps. */
  tick(realMs: number): void;
  /** Consume one fixed step if enough time has accumulated. Returns whether a step ran. */
  step(): boolean;
  /** Leftover accumulator / fixedStepMs, in [0, 1) after draining steps (up to maxCatchUp when not drained). */
  readonly alpha: number;
  /** Number of fixed steps consumed so far. */
  readonly frame: number;
  reset(): void;
}

export interface ClockOptions {
  /** Fixed step length in ms. Default 1000/60. */
  fixedStepMs?: number;
  /** Max fixed steps of backlog kept after a long tick. Default 5. */
  maxCatchUp?: number;
}

export interface TestClock extends Clock {
  /** Run `n` fixed steps deterministically, with no real time involved. */
  advance(n: number): void;
}

export function createClock(opts: ClockOptions = {}): Clock {
  const fixedStepMs = opts.fixedStepMs ?? 1000 / 60;
  const maxCatchUp = opts.maxCatchUp ?? 5;
  if (!(fixedStepMs > 0)) throw new RangeError('fixedStepMs must be > 0');
  if (!(maxCatchUp >= 1)) throw new RangeError('maxCatchUp must be >= 1');
  const cap = fixedStepMs * maxCatchUp;
  let acc = 0;
  let frame = 0;
  return {
    now: () => frame * fixedStepMs,
    tick(realMs: number) {
      if (!(realMs > 0)) return;
      acc = Math.min(acc + realMs, cap);
    },
    step() {
      if (acc + 1e-9 < fixedStepMs) return false;
      acc = Math.max(0, acc - fixedStepMs);
      frame++;
      return true;
    },
    get alpha() { return Math.min(acc / fixedStepMs, 1); },
    get frame() { return frame; },
    reset() { acc = 0; frame = 0; },
  };
}

/** Deterministic clock for `?test=1` samples: time only moves via advance(). */
export function createTestClock(fixedStepMs: number = 1000 / 60): TestClock {
  const c = createClock({ fixedStepMs, maxCatchUp: Number.MAX_SAFE_INTEGER });
  return {
    now: c.now,
    tick: c.tick,
    step: c.step,
    get alpha() { return c.alpha; },
    get frame() { return c.frame; },
    reset: c.reset,
    advance(n: number) {
      for (let i = 0; i < n; i++) {
        c.tick(fixedStepMs);
        c.step();
      }
    },
  };
}
