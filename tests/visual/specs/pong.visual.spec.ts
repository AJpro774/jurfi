import { expect, test } from '@playwright/test';
import { assertNoErrors, openSample } from '../helpers/deterministic';

type PongApi = { advance(n: number): void; start(): void };
declare global { interface Window { __pong: PongApi } }

// Freeze the rAF loop (allow only the first couple of calls for boot) so that window.__pong.advance(n)
// is the only thing stepping the simulation: frames are then exactly reproducible.
const freezeRaf = (): void => {
  const orig = window.requestAnimationFrame.bind(window);
  let n = 0;
  window.requestAnimationFrame = (cb) => (n++ < 2 ? orig(cb) : 0);
};

test('pong serve screen matches baseline', async ({ page }) => {
  await page.addInitScript(freezeRaf);
  const errs = await openSample(page, '/pong/', { selector: '#game' });
  await page.waitForFunction(() => !!window.__pong);
  await page.evaluate(() => window.__pong.advance(0));
  await expect(page.locator('#game')).toHaveScreenshot('pong-serve.png', { maxDiffPixelRatio: 0.005 });
  assertNoErrors(errs);
});

test('pong after 120 deterministic steps matches baseline', async ({ page }) => {
  await page.addInitScript(freezeRaf);
  const errs = await openSample(page, '/pong/', { selector: '#game' });
  await page.waitForFunction(() => !!window.__pong);
  await page.evaluate(() => { window.__pong.start(); window.__pong.advance(120); });
  await expect(page.locator('#game')).toHaveScreenshot('pong-120.png', { maxDiffPixelRatio: 0.005 });
  assertNoErrors(errs);
});
