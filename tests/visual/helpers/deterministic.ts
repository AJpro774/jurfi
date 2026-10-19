import { expect, type Page } from '@playwright/test';

export const SEED = 1337;

/** mulberry32 PRNG source, injected into the page before any script runs. */
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

export interface Collected {
  errors: string[];
}

/** Collect console errors + uncaught page errors. Call assertNoErrors() at end of test. */
export function collectErrors(page: Page): Collected {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors };
}

export function assertNoErrors(c: Collected): void {
  expect(c.errors, c.errors.join('\n')).toEqual([]);
}

/** True if the canvas has at least `minDistinct` distinct colors (2D readback via a copy canvas; works for WebGL/WebGPU only when drawn in the same frame, so we use a screenshot-independent copy). */
export async function canvasIsBlank(page: Page, selector = 'canvas'): Promise<boolean> {
  return page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel);
    if (!c || c.width === 0 || c.height === 0) return true;
    const copy = document.createElement('canvas');
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
    const first = (d[0]! << 16) | (d[1]! << 8) | d[2]!;
    for (let i = 4; i < d.length; i += 4) {
      if (((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!) !== first) return false;
    }
    return true; // single flat color
  }, selector);
}

export async function assertCanvasNotBlank(page: Page, selector = 'canvas'): Promise<void> {
  expect(await canvasIsBlank(page, selector), `canvas ${selector} is blank (single flat colour)`).toBe(false);
}

export interface OpenOptions {
  selector?: string;
  seed?: number;
  /** extra query string, e.g. "&scene=a" */
  extraQuery?: string;
}

/**
 * Open a sample deterministically: fixed seed, ?test=1, canvas present and non-blank.
 * Prefers an app-provided `window.__JURFI_READY__ === true` flag if the sample sets one,
 * otherwise falls back to "canvas exists with size and is not blank".
 */
export async function openSample(page: Page, path: string, opts: OpenOptions = {}): Promise<Collected> {
  const { selector = 'canvas', seed = SEED, extraQuery = '' } = opts;
  const collected = collectErrors(page);
  await page.addInitScript(seedScript, seed);
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}test=1${extraQuery}`, { waitUntil: 'load' });
  await page.waitForSelector(selector, { state: 'visible' });
  await page.waitForFunction(
    (sel) => {
      const w = window as unknown as { __JURFI_READY__?: boolean };
      if (w.__JURFI_READY__ === true) return true;
      const c = document.querySelector<HTMLCanvasElement>(sel);
      return !!c && c.width > 0 && c.height > 0;
    },
    selector,
    { timeout: 15_000 },
  );
  await expect.poll(() => canvasIsBlank(page, selector), { timeout: 15_000, message: 'canvas never became non-blank' }).toBe(false);
  return collected;
}
