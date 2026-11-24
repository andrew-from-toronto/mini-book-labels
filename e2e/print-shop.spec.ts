import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The print shop and cutting machine downloads, made from the sample books. Set KEEP_FILES to a folder to
 * keep copies of what was made, for opening in a PDF viewer.
 */

test.skip(({ isMobile }) => isMobile, 'Desktop layout only');

async function start(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('./');
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  // Every label drawn at print resolution (45 mm at 24 px/mm): every cover found or generated.
  await expect
    .poll(() => page.evaluate(() => Math.min(...[...document.querySelectorAll<HTMLCanvasElement>('.sheet canvas.label')].map((c) => c.width))), { timeout: 60_000 })
    .toBe(1080);
  return errors;
}

async function download(page: Page, link: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: link }).click()]);
  const path = await file.path();
  if (process.env.KEEP_FILES) copyFileSync(path, join(process.env.KEEP_FILES, file.suggestedFilename()));
  return readFileSync(path);
}

test('makes a print shop PDF and its proof, with bleed and cut lines', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await start(page);
  await page.getByRole('combobox', { name: 'Print with' }).selectOption('shop');
  // The preview shows each label with its bleed, its cut line and safe zone.
  await expect(page.locator('.sheet .slot').first()).toBeVisible();
  await expect(page.locator('.sheet .cut-line').first()).toBeVisible();
  // 45 x 30 mm plus 3.175 mm bleed each side, at 24 px/mm once drawn at print resolution.
  await expect
    .poll(() => page.locator('.sheet .slot canvas.label').first().evaluate((c: HTMLCanvasElement) => [c.width, c.height]), { timeout: 30_000 })
    .toEqual([Math.round(45 * 24) + 2 * Math.round(3.175 * 24), Math.round(30 * 24) + 2 * Math.round(3.175 * 24)]);
  await page.getByLabel('Crop marks').check();
  await expect(page.locator('.sheet-marks line').first()).toBeAttached();

  await page.getByRole('button', { name: 'Make print file and proof' }).click();
  await expect(page.getByRole('link', { name: /-print\.pdf$/ })).toBeVisible({ timeout: 120_000 });
  const print = await download(page, (await page.getByRole('link', { name: /-print\.pdf$/ }).textContent())!);
  const proof = await download(page, (await page.getByRole('link', { name: /-proof\.pdf$/ }).textContent())!);
  for (const pdf of [print, proof]) {
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.6');
    expect(pdf.subarray(-6).toString('latin1')).toBe('%%EOF\n');
  }
  const raw = print.toString('latin1');
  expect(raw).toContain('/Separation /CutContour');
  expect(raw).toContain('/DCTDecode');
  // Changing a setting clears the files made for the old one.
  await page.getByRole('combobox', { name: 'Cut', exact: true }).selectOption('die');
  await expect(page.getByRole('link', { name: /-print\.pdf$/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('makes a CMYK print file with the GRACoL profile', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await start(page);
  await page.getByRole('combobox', { name: 'Print with' }).selectOption('shop');
  await page.getByRole('combobox', { name: 'Colour', exact: true }).selectOption('cmyk');
  await page.getByRole('button', { name: 'Make print file and proof' }).click();
  await expect(page.getByRole('link', { name: /-print\.pdf$/ })).toBeVisible({ timeout: 150_000 });
  const print = await download(page, (await page.getByRole('link', { name: /-print\.pdf$/ }).textContent())!);
  const raw = print.toString('latin1');
  expect(raw).toContain('/DestOutputProfile');
  expect(raw).toContain('/ColorSpace /DeviceCMYK');
  expect(errors).toEqual([]);
});

test('makes Cricut and Silhouette downloads', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await start(page);
  await page.getByRole('combobox', { name: 'Print with' }).selectOption('cricut');
  await page.getByRole('button', { name: 'Make Cricut images' }).click();
  const cricut = await download(page, (await page.getByRole('link', { name: /cricut.*\.zip$/ }).textContent({ timeout: 120_000 }))!);
  expect(cricut.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
  expect(cricut.toString('latin1')).toContain('README.txt');

  await page.getByRole('combobox', { name: 'Print with' }).selectOption('silhouette');
  await expect(page.locator('.reg-marks').first()).toBeAttached();
  await page.getByRole('button', { name: 'Make Silhouette files' }).click();
  const silhouette = await download(page, (await page.getByRole('link', { name: /silhouette.*\.zip$/ }).textContent({ timeout: 120_000 }))!);
  const text = silhouette.toString('latin1');
  expect(text).toContain('-cut.dxf');
  expect(text).toContain('.svg');
  expect(errors).toEqual([]);
});
