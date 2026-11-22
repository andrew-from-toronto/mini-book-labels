import { expect, test } from '@playwright/test';

/** The back cover's options, and printing straight after an edit getting full-resolution labels. */

test('back cover options apply, and printing right after an edit is at full resolution', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Mini Book Labels' })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Setup/ }).click();
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Setup/ }).click();
  await page.getByRole('combobox', { name: 'Back cover', exact: true }).selectOption('mirror');
  const panel = page.locator('.back-options');
  await panel.getByLabel('Mirror left to right').check();
  await panel.getByLabel('Flip upside down').check();
  await panel.getByLabel('Carry the artwork across the spine').check();
  await panel.getByLabel('Barcode').uncheck();
  // Straight to print, before print resolution has had time to land.
  const widths = await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeprint'));
    return [...document.querySelectorAll<HTMLCanvasElement>('.sheet canvas.label')].map((c) => c.width);
  });
  // Saved with the rest of the settings, a moment after the last change.
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mini-book-labels:v1') ?? '{}').settings?.backOptions))
    .toMatchObject({ upsideDown: true, artSpine: true, barcode: false });
  // 20 + 5 + 20 mm at 24 px/mm.
  expect(Math.min(...widths)).toBe(1080);
  await page.getByRole('button', { name: 'Reset back to defaults' }).click();
  await expect(panel.getByLabel('Flip upside down')).not.toBeChecked();
  expect(errors).toEqual([]);
});
