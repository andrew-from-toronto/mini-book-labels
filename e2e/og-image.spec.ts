import { expect, test } from '@playwright/test';

/**
 * Regenerates public/og-image.png, the picture shown when the site is shared and on the guide page:
 * pnpm og. The book is invented artwork, drawn here, so no real cover is used in the site's own images.
 */
test('og image', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one image, made at desktop size');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // An invented book, so the image uses no real cover art. Laid out like a label: back, spine, front.
  const art = await page.evaluate(async () => {
    await document.fonts.ready;
    const c = document.createElement('canvas');
    const [w, h, spineL, spineR] = [1350, 900, 600, 750];
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1f4d3a');
    grad.addColorStop(1, '#163a2c');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9b45a';
    g.lineWidth = 10;
    g.strokeRect(spineR + 40, 40, w - spineR - 80, h - 80);
    g.fillStyle = '#d9b45a';
    g.fillRect(spineL, 0, spineR - spineL, h);
    g.textAlign = 'center';
    g.fillStyle = '#f3e6c4';
    g.font = 'bold 100px Georgia, serif';
    g.fillText('The', (spineR + w) / 2, 300);
    g.fillText('Winter', (spineR + w) / 2, 430);
    g.fillText('Almanac', (spineR + w) / 2, 560);
    g.font = 'italic 52px Georgia, serif';
    g.fillText('E. M. Holloway', (spineR + w) / 2, 700);
    // A snowflake ornament above the title.
    g.strokeStyle = '#f3e6c4';
    g.lineWidth = 8;
    for (let a = 0; a < 6; a++) {
      g.beginPath();
      g.moveTo((spineR + w) / 2, 150);
      g.lineTo((spineR + w) / 2 + 50 * Math.cos((a * Math.PI) / 3), 150 + 50 * Math.sin((a * Math.PI) / 3));
      g.stroke();
    }
    // Spine title, reading top to bottom.
    g.save();
    g.translate((spineL + spineR) / 2, h / 2);
    g.rotate(Math.PI / 2);
    g.fillStyle = '#1f4d3a';
    g.font = 'bold 64px Georgia, serif';
    g.fillText('The Winter Almanac', 0, 22);
    g.restore();
    // Back cover: blurb lines.
    g.fillStyle = 'rgba(243, 230, 196, 0.55)';
    for (let i = 0; i < 7; i++) g.fillRect(90, 220 + i * 56, i % 3 === 2 ? 300 : 420, 18);
    return c.toDataURL('image/png').split(',')[1];
  });

  await page.getByRole('combobox', { name: /Add any book/ }).fill('9781635575637');
  await page.getByRole('option').first().click();
  await expect(page.locator('.cover-edit')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/Image is the full wrap/).check();
  await page.locator('.cover-edit input[type="file"]').setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: Buffer.from(art, 'base64') });
  await expect(page.getByText(/Spine width/)).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Ornament hook on top').check();
  await expect(page.getByText(/Drag to turn/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const book = (await page.locator('.book3d-canvas').screenshot()).toString('base64');

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`
    <style>
      body { margin: 0; }
      .card { width: 1200px; height: 630px; display: grid; grid-template-columns: 560px 1fr; align-items: center;
        background: #f4f1ec; font-family: Georgia, serif; color: #23201c; overflow: hidden; }
      .book { height: 630px; background: url(data:image/png;base64,${book}) center / cover no-repeat; }
      h1 { font-size: 64px; line-height: 1.05; margin: 0 0 22px; }
      p { font: 30px/1.35 system-ui, sans-serif; color: #5b5349; margin: 0 0 30px; max-width: 560px; }
      .tag { display: inline-block; font: 600 26px system-ui, sans-serif; color: #fff; background: #8a4b2a; padding: 10px 18px; border-radius: 10px; }
    </style>
    <div class="card"><div class="book"></div><div>
      <h1>Mini book ornaments of your favourite books</h1>
      <p>Free printable covers from your reading list, and a free 3D printable book with a hook.</p>
      <span class="tag">Mini Book Labels</span>
    </div></div>`);
  await page.locator('.card').screenshot({ path: 'public/og-image.png' });
});
