import { test } from '@playwright/test';
import { assertCanvasNotBlank, assertNoErrors, openSample } from '../helpers/deterministic';

test('pong runs ~5s without errors and renders', async ({ page }) => {
  const errs = await openSample(page, '/pong/', { selector: '#game' });
  await page.waitForTimeout(5000);
  await assertCanvasNotBlank(page, '#game');
  assertNoErrors(errs);
});
