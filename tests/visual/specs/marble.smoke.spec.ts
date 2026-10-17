import { expect, test, type Page } from '@playwright/test';
import { assertNoErrors, collectErrors, SEED } from '../helpers/deterministic';

interface MarbleApi {
  start(): void;
  advance(n: number): void;
  game: { pos: unknown; vel: unknown; roll: unknown; gems: unknown; collected: number; phase: string; frame: number; steps: number };
}
declare global { interface Window { __marble: MarbleApi } }

test.use({ viewport: { width: 1280, height: 800 } });

// Seeded Math.random, same generator as the helpers (the sample also uses its own fixed rng under ?test=1).
const seedScript = (seed: number): void => {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Under ?test=1 every rAF frame steps the sim, so the pre-evaluate frame count would vary with timing.
// Allow only the first couple of rAF calls (boot/first draw) so start()+advance(n) is the only stepping.
const freezeRaf = (): void => {
  const orig = window.requestAnimationFrame.bind(window);
  let n = 0;
  window.requestAnimationFrame = (cb) => (n++ < 2 ? orig(cb) : 0);
};

/** Load marble (?test=1 forces webgl2), then start + advance in ONE evaluate so no rAF frame can interleave; return the game state. */
async function loadAndRun(page: Page, steps: number): Promise<string> {
  const errs = collectErrors(page);
  // Also keep console warnings + page errors from the very start, to explain a boot failure (e.g. no WebGL2).
  const diag: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') diag.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => diag.push(`pageerror: ${e.message}`));
  await page.addInitScript(seedScript, SEED);
  await page.addInitScript(freezeRaf);
  await page.goto('/marble/?test=1', { waitUntil: 'load' });
  await page.waitForSelector('#game', { state: 'visible' });
  try {
    await page.waitForFunction(() => !!window.__marble, undefined, { timeout: 15_000 });
  } catch (e) {
    const ua = await page.evaluate(() => navigator.userAgent).catch(() => '(unavailable)');
    const gl2 = await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null).catch(() => 'unknown');
    throw new Error(
      `window.__marble never appeared: ${(e as Error).message.split('\n')[0]}\n` +
      `userAgent: ${ua}\nWebGL2 context creatable: ${String(gl2)}\n` +
      `collected console/page errors (${diag.length}):\n${diag.join('\n') || '(none)'}`,
    );
  }
  const state = await page.evaluate((n) => {
    window.__marble.start();
    window.__marble.advance(n);
    const g = window.__marble.game;
    return JSON.stringify({ pos: g.pos, vel: g.vel, roll: g.roll, gems: g.gems, collected: g.collected, phase: g.phase, frame: g.frame, steps: g.steps });
  }, steps);
  assertNoErrors(errs);
  return state;
}

test('marble loads without errors and is deterministic across two loads', async ({ page, context }) => {
  const a = await loadAndRun(page, 120);
  expect(JSON.parse(a).phase).toBe('play');
  const b = await loadAndRun(await context.newPage(), 120); // fresh page: independent init scripts
  expect(b).toBe(a);
});
