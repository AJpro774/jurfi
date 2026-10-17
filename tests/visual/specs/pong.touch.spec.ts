import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { assertNoErrors, openSample } from '../helpers/deterministic';

type PongApi = { game: { phase: string } };

// CDP touch only exists in Chromium. A zero-duration Playwright tap() is missed by design for now
// (the serve button samples pressed state per frame), so hold ~100ms.
test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });
test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch is Chromium-only');

const HOLD_MS = 100;

async function cdpTap(cdp: CDPSession, page: Page, x: number, y: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(HOLD_MS);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const phase = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { __pong: PongApi }).__pong.game.phase);

async function canvasCentre(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await page.locator('#game').boundingBox();
  if (!b) throw new Error('canvas not found');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

test('pong serve button works via CDP touch (100ms hold) across a 1280x800 -> 390x844 resize', async ({ page }) => {
  const errs = await openSample(page, '/pong/', { selector: '#game' });
  await page.waitForFunction(() => !!(window as unknown as { __pong?: unknown }).__pong);
  const cdp = await page.context().newCDPSession(page);

  // 1280x800: canvas fills the window (8:5).
  expect(await phase(page)).toBe('serve');
  let c = await canvasCentre(page);
  expect(Math.round(c.w)).toBe(1280);
  await cdpTap(cdp, page, c.x, c.y);
  await expect.poll(() => phase(page)).toBe('play');

  // Back to the serve screen, then resize to a phone portrait viewport.
  await page.evaluate(() => { (window as unknown as { __pong: PongApi }).__pong.game.phase = 'serve'; });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => Math.round((await canvasCentre(page)).w)).toBe(390);
  c = await canvasCentre(page);
  expect(Math.round(c.h)).toBe(244); // 390 / 1.6

  // A tap in the letterbox (outside the resized canvas) must not serve: hit region follows the canvas rect.
  await cdpTap(cdp, page, c.x, 50);
  await page.waitForTimeout(150);
  expect(await phase(page)).toBe('serve');

  // A tap on the resized canvas serves.
  await cdpTap(cdp, page, c.x, c.y);
  await expect.poll(() => phase(page)).toBe('play');

  assertNoErrors(errs);
});
