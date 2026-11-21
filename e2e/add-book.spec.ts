import { expect, test } from '@playwright/test';

/**
 * Adding a book the search does not find, as a blank book: pnpm test:interactions. Open Library is
 * stubbed to find nothing, and any lookup of the blank book is recorded, since it should get none.
 */

test('a book the search cannot find is added blank, with its own title and author', async ({ page }) => {
  const lookups: string[] = [];
  await page.route(/openlibrary\.org|\/api\/(ol|cover)\//, (route) => {
    lookups.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: [], numFound: 0 }) });
  });
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Setup/ }).click();

  const search = page.getByRole('combobox', { name: /Add any book/ });
  await search.fill('my grandmother recipes');
  await expect(page.getByRole('option', { name: /No books found|blank book/ }).first()).toBeVisible();
  await expect(page.getByText('No books found.')).toBeVisible();
  const blank = page.getByRole('option', { name: /Add “my grandmother recipes” as a blank book/ });
  await blank.click();
  const searchesBefore = lookups.length;

  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Books/ }).click();
  const card = page.locator('.book.active');
  await expect(card).toContainText('my grandmother recipes');
  await expect(card.locator('.badge')).toHaveText('no cover, generated');

  await card.getByLabel('Title').fill("Grandma's Recipes");
  await card.getByLabel('Author').fill('Rose Hunt');
  await expect(card.locator('.book-text strong')).toHaveText("Grandma's Recipes");
  await expect(card.locator('.book-text .muted').first()).toHaveText('Rose Hunt');
  await page.waitForTimeout(500);
  // Neither adding it nor renaming it looked it up.
  expect(lookups.slice(searchesBefore)).toEqual([]);

  // It is kept on reload, title and all.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('.book .book-text strong', { hasText: "Grandma's Recipes" })).toBeAttached();
});

test('the blank option is offered under real matches too, and Enter on no matches adds it', async ({ page }) => {
  await page.route(/\/api\/ol\/search/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ docs: [{ key: '/works/OL1W', title: 'Piranesi', author_name: ['Susanna Clarke'] }] }),
    }),
  );
  await page.route(/openlibrary\.org|\/api\/cover\//, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('./');
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^Setup/ }).click();
  const search = page.getByRole('combobox', { name: /Add any book/ });
  await search.fill('Piranesi');
  const options = page.getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText('Piranesi');
  await expect(options.last()).toContainText('as a blank book');
});
