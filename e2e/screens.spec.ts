import { expect, test, type Page } from '@playwright/test';

/**
 * Screenshots of the app's main states for visual review: pnpm screens, then look in screens/.
 * Not assertions about pixels: each step only checks enough to know the screenshot shows the right thing.
 */

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `screens/${test.info().project.name}-${name}.png` });

/** On narrow screens the app shows one pane at a time; this opens one if the tab bar is there. */
async function openTab(page: Page, name: 'Setup' | 'Books' | 'Preview') {
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

/** Covers load from Open Library; give them a moment so screenshots show real covers. */
const settle = (page: Page, ms = 2500) => page.waitForTimeout(ms);

test.beforeEach(async ({ page }) => {
  // The same sample every run, so screenshots can be compared before and after a change.
  await page.addInitScript(() => {
    let seed = 42;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
  });
  await page.goto('./');
});

test('screens', async ({ page }) => {
  await shot(page, '01-empty');

  await openTab(page, 'Setup');
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  // Loading jumps to the Books tab on narrow screens, so look for the cards rather than the setup text.
  await expect(page.locator('.book').first()).toBeAttached();
  await openTab(page, 'Books');
  await settle(page);
  await shot(page, '02-sample-books');

  await openTab(page, 'Setup');
  await page.getByRole('heading', { name: '2. Filters' }).scrollIntoViewIfNeeded();
  await page.getByRole('heading', { name: '2. Filters' }).evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await shot(page, '02b-filters');
  await openTab(page, 'Books');

  await page.locator('.book-head').first().click();
  await expect(page.locator('.cover-edit')).toBeVisible();
  await settle(page);
  await shot(page, '03-book-open');

  // The edition covers: pick one, then point at another, to see both un-stacked.
  const variants = page.locator('.variant-strip li');
  await expect(variants.first()).toBeVisible({ timeout: 15_000 });
  await variants.nth(2).locator('button').click();
  await settle(page, 1500);
  await variants.nth(5).hover();
  await page.waitForTimeout(400);
  await page.locator('.variants').screenshot({ path: `screens/${test.info().project.name}-03b-variants.png` });

  await openTab(page, 'Preview');
  await settle(page, 1000);
  await shot(page, '04-print-preview');

  await page.getByRole('button', { name: '3D book' }).click();
  await expect(page.getByText(/Drag to turn/)).toBeVisible({ timeout: 20_000 });
  await settle(page, 1500);
  await shot(page, '05-3d-book');

  await openTab(page, 'Setup');
  const model = page.getByRole('heading', { name: '5. 3D model' });
  await model.scrollIntoViewIfNeeded();
  await page.getByLabel('Ornament hook on top').check();
  await shot(page, '06-model-panel');

  const search = page.getByRole('combobox', { name: /Add any book/ });
  await search.scrollIntoViewIfNeeded();
  await search.fill('piranesi');
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
  await settle(page, 1500);
  await shot(page, '07-search');
});
