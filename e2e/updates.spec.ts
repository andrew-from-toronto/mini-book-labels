import { expect, test } from '@playwright/test';

/** An open tab notices a new deploy and offers to reload (src/lib/updates.ts): pnpm test:interactions. */

test.beforeEach(async ({ page }) => {
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => localStorage.setItem('updates', 'force'));
});

test('a newer build is offered as a reload when the tab comes back', async ({ page }) => {
  let latest = 'dev';
  await page.route('**/version.json*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: latest }) }),
  );
  await page.goto('./');
  const banner = page.getByRole('status').filter({ hasText: 'new version' });

  // The same build: nothing to offer.
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  await expect(banner).toHaveCount(0);

  // A deploy later (the check waits a minute between looks, so wind the clock on).
  latest = 'abc1234-new';
  await page.evaluate(() => {
    const now = Date.now();
    Date.now = () => now + 2 * 60 * 1000;
    dispatchEvent(new Event('focus'));
  });
  await expect(banner).toBeVisible();

  // Later puts it away; Reload reloads.
  await banner.getByRole('button', { name: 'Later' }).click();
  await expect(banner).toHaveCount(0);
  await page.evaluate(() => {
    const now = Date.now();
    Date.now = () => now + 40 * 60 * 1000;
    dispatchEvent(new Event('focus'));
  });
  await expect(banner).toBeVisible();
  await Promise.all([page.waitForEvent('load'), banner.getByRole('button', { name: 'Reload' }).click()]);
});

test('every split-off part of the app loads with the page, not when first opened', async ({ page }) => {
  const loaded: string[] = [];
  page.on('response', (r) => loaded.push(new URL(r.url()).pathname));
  await page.goto('./');
  // The 3D view, the coffee dialog and the geometry engine's WebAssembly, before anyone opens them.
  await expect.poll(() => loaded.some((u) => /Book3D/.test(u))).toBe(true);
  await expect.poll(() => loaded.some((u) => /CoffeeDialog/.test(u))).toBe(true);
  await expect.poll(() => loaded.some((u) => /manifold.*\.wasm/.test(u))).toBe(true);
});
