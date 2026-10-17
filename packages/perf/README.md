# @jurfi/perf

Profiler, budgets, GPU timer, plus a deterministic fixed-step clock and seeded RNG.

```ts
import { createClock, createTestClock, createRng } from '@jurfi/perf';

const clock = createClock({ fixedStepMs: 1000 / 60, maxCatchUp: 5 });
clock.tick(realDeltaMs);
while (clock.step()) update();
render(clock.alpha);

const t = createTestClock(); t.advance(120);   // `?test=1` samples: no real time

const rng = createRng('seed');                 // PCG32
rng.next(); rng.int(0, 10) /* 0..9 */; rng.pick(['a', 'b']);
const sub = rng.fork('particles');             // independent stream
const saved = rng.state; rng.state = saved;    // save / replay
```

`int(min, max)` is min-inclusive, max-exclusive. See docs/api/input-audio-perf.md.
