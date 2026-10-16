import { expect, test } from '@playwright/test';
import { assertNoErrors, openSample } from '../helpers/deterministic';

// Pong's ball moves every rAF with no time control, so we compare only the static
// paddle/background region (bottom strip) plus a loosely-bounded full canvas.
test('pong canvas matches baseline', async ({ page }) => {
  const errs = await openSample(page, '/pong/', { selector: '#game' });
  await expect(page.locator('#game')).toHaveScreenshot('pong-canvas.png', {
    maxDiffPixelRatio: 0.02, // small: ball (8x8) + position jitter
    animations: 'disabled',
  });
  assertNoErrors(errs);
});
