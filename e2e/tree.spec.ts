import { expect, test } from '@playwright/test';

/** The tree view (Tree3D): builds, hangs the books, and its options work, with no script errors. */

test('hangs the books on a tree whose size, lights and shuffle can be changed', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/openlibrary\.org|\/api\/(ol|cover)\//, (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Setup/ }).click();
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Preview/ }).click();
  await page.getByRole('button', { name: 'Tree', exact: true }).click();

  const status = page.locator('.tree-bar .muted');
  await expect(status).toContainText(/\d+ books\./, { timeout: 60_000 });
  await expect(page.locator('.tree3d canvas')).toBeVisible();
  await page.getByRole('combobox', { name: 'Tree size' }).selectOption('large');
  await page.getByRole('combobox', { name: 'Lights' }).selectOption('colour');
  await page.getByRole('combobox', { name: 'Baubles' }).selectOption('none');
  await page.getByRole('combobox', { name: 'Baubles' }).selectOption('silver');
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(status).toContainText(/\d+ books\./);
  // The choices are remembered for next time.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mini Book Labels' })).toBeVisible();
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Preview/ }).click();
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tree size' })).toHaveValue('large');
  await expect(page.getByRole('combobox', { name: 'Lights' })).toHaveValue('colour');
  await expect(page.getByRole('combobox', { name: 'Baubles' })).toHaveValue('silver');
  expect(errors).toEqual([]);
});

test('changing the ornament hook while looking at the tree stays on the tree', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, 'needs Setup and Preview side by side');
  await page.route(/openlibrary\.org|\/api\/(ol|cover)\//, (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  const tree = page.getByRole('button', { name: 'Tree', exact: true });
  await tree.click();
  await page.getByLabel('Ornament hook on top').check();
  await page.getByLabel('Hook along the top').selectOption('spine');
  await expect(tree).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tree3d')).toBeVisible();
  // From the print sheet, a change still shows the 3D book, as before.
  await page.getByRole('group', { name: 'Preview' }).getByRole('button', { name: 'Print sheet' }).click();
  await page.getByLabel('Hook along the top').selectOption('center');
  await expect(page.getByRole('button', { name: '3D book' })).toHaveAttribute('aria-pressed', 'true');
});

test('a custom height, in feet or centimetres, is remembered', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/openlibrary\.org|\/api\/(ol|cover)\//, (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Mini Book Labels' })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Preview/ }).click();
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tree size' }).selectOption('custom');
  const box = page.getByRole('spinbutton', { name: 'Tree height' });
  // Switching units straight after typing keeps what was typed.
  await box.fill('6.5');
  await page.getByRole('combobox', { name: 'Height unit' }).selectOption('cm');
  await expect(box).toHaveValue('198');
  // Too tall for a room: kept to 12 ft once the box is left.
  await box.fill('900');
  await box.blur();
  await expect(box).toHaveValue('366');
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mini Book Labels' })).toBeVisible();
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Preview/ }).click();
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tree size' })).toHaveValue('custom');
  await expect(page.getByRole('spinbutton', { name: 'Tree height' })).toHaveValue('366');
  await expect(page.getByRole('combobox', { name: 'Height unit' })).toHaveValue('cm');
  expect(errors).toEqual([]);
});

test('clicking a book in the list flies to its ornament on the tree, and back out when closed', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, 'needs the list and the tree side by side');
  test.setTimeout(120_000);
  await page.route(/openlibrary\.org|\/api\/(ol|cover)\//, (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  await expect(page.locator('.tree-bar .muted')).toContainText(/\d+ books\./, { timeout: 60_000 });
  const card = page.locator('.book').nth(3);
  const id = await card.getAttribute('data-drag-id');
  await card.locator('.book-head').click();
  // Still on the tree, and the camera has landed in front of that book.
  await expect(page.getByRole('button', { name: 'Tree', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tree3d .book3d-canvas')).toHaveAttribute('data-focused', id!, { timeout: 30_000 });
  await card.locator('.book-head').click();
  await expect(page.locator('.tree3d .book3d-canvas')).toHaveAttribute('data-focused', '', { timeout: 30_000 });
});
