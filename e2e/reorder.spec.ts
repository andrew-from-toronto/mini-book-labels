import { expect, test, type Page } from '@playwright/test';

/**
 * Dragging book cards into a new order (useDragOrder), in each browser engine: pnpm test:interactions.
 * Chromium stands in for Chrome and Edge, WebKit for Safari. Covers come from a stub so the run is
 * quick and offline; the order is what is checked, not the pictures.
 */

test.beforeEach(async ({ page }) => {
  await page.route(/openlibrary\.org|\/api\/(ol|cover)\//, (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Setup/ }).click();
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Books/ }).click();
  await expect(page.locator('.book').nth(3)).toBeVisible();
});

const titles = (page: Page) => page.locator('.book .book-text strong').allTextContents();

/** Centre of a card's cover thumbnail, and a point just inside the right edge of another card. */
async function points(page: Page, from: number, to: number) {
  const a = (await page.locator('.book').nth(from).locator('canvas').boundingBox())!;
  const b = (await page.locator('.book').nth(to).boundingBox())!;
  return { start: { x: a.x + a.width / 2, y: a.y + a.height / 2 }, end: { x: b.x + b.width - 8, y: b.y + b.height / 2 } };
}

test('a mouse drags a card to after another', async ({ page, hasTouch }) => {
  test.skip(hasTouch, 'mouse only');
  const before = await titles(page);
  const { start, end } = await points(page, 0, 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y + 5, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => titles(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
  // The release does not also open the card it landed on.
  await expect(page.locator('.book.active')).toHaveCount(0);

  // And again straight after, which a drag left hanging would block.
  const again = await titles(page);
  const second = await points(page, 2, 0);
  await page.mouse.move(second.start.x, second.start.y);
  await page.mouse.down();
  await page.mouse.move(second.start.x - 20, second.start.y, { steps: 4 });
  const first = (await page.locator('.book').nth(0).boundingBox())!;
  await page.mouse.move(first.x + 8, first.y + first.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => titles(page)).toEqual([again[2], again[0], again[1], ...again.slice(3)]);
});

test('a finger long-presses, then drags a card', async ({ page, hasTouch, browserName }) => {
  test.skip(!hasTouch || browserName !== 'chromium', 'touch moves need Chromium (CDP)');
  const before = await titles(page);
  const { start, end } = await points(page, 0, 2);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', start.x, start.y);
  await page.waitForTimeout(500);
  for (let i = 1; i <= 15; i++) {
    await touch('touchMove', start.x + ((end.x - start.x) * i) / 15, start.y + ((end.y - start.y) * i) / 15);
  }
  await touch('touchEnd', end.x, end.y);
  await expect.poll(() => titles(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
});

test('a quick swipe on a card scrolls rather than drags', async ({ page, hasTouch, browserName }) => {
  test.skip(!hasTouch || browserName !== 'chromium', 'touch moves need Chromium (CDP)');
  const before = await titles(page);
  const { start } = await points(page, 0, 2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y - i * 15 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  expect(await titles(page)).toEqual(before);
});

/** Pointer events sent straight from the page, all in one go, so React gets no chance to re-render between them. */
async function dragAtOnce(page: Page, from: number, to: number, opts: { loseRelease?: boolean } = {}) {
  await page.evaluate(
    ({ from, to, loseRelease }) => {
      const cards = [...document.querySelectorAll<HTMLElement>('.book')];
      const a = cards[from].querySelector('canvas')!.getBoundingClientRect();
      const b = cards[to].getBoundingClientRect();
      const send = (target: EventTarget, type: string, x: number, y: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: x,
            clientY: y,
          }),
        );
      const x0 = a.left + a.width / 2;
      const y0 = a.top + a.height / 2;
      send(cards[from].querySelector('canvas')!, 'pointerdown', x0, y0);
      send(window, 'pointermove', x0 + 20, y0);
      send(window, 'pointermove', b.right - 8, b.top + b.height / 2);
      if (!loseRelease) send(window, 'pointerup', b.right - 8, b.top + b.height / 2);
    },
    { from, to, loseRelease: opts.loseRelease ?? false },
  );
}

test('a release straight after the last move lands where the pointer is', async ({ page }) => {
  const before = await titles(page);
  await dragAtOnce(page, 0, 2);
  await expect.poll(() => titles(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
});

test('a release the page never hears does not block the next drag', async ({ page }) => {
  await dragAtOnce(page, 0, 2, { loseRelease: true });
  await page.waitForTimeout(100);
  const before = await titles(page);
  await dragAtOnce(page, 1, 3);
  await expect.poll(() => titles(page)).toEqual([before[0], before[2], before[3], before[1], ...before.slice(4)]);
});
