import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Open Library allows about 100 cover lookups per 5 minutes per address, which several devices loading
 * the sample at once soon exceed. Its replies are kept on disk the first time and replayed after, so
 * runs do not hit the limit and screenshots show the same covers each time. Rate-limited replies are
 * not kept. Delete test-results/openlibrary-cache to fetch afresh.
 */
const CACHE = 'test-results/openlibrary-cache';

async function cacheOpenLibrary(page: Page) {
  mkdirSync(CACHE, { recursive: true });
  await page.route(/^https:\/\/(covers\.)?openlibrary\.org\//, async (route) => {
    const key = createHash('sha1').update(route.request().url()).digest('hex');
    const [body, meta] = [`${CACHE}/${key}`, `${CACHE}/${key}.json`];
    if (existsSync(meta)) {
      const { status, headers } = JSON.parse(readFileSync(meta, 'utf8'));
      return route.fulfill({ status, headers, body: readFileSync(body) });
    }
    const response = await route.fetch().catch(() => null);
    if (!response) return route.abort();
    const headers = { ...response.headers(), 'access-control-allow-origin': '*' };
    const keep = response.status() === 200 || response.status() === 404;
    if (keep) {
      writeFileSync(body, await response.body());
      writeFileSync(meta, JSON.stringify({ status: response.status(), headers }));
    }
    return route.fulfill({ response, headers });
  });
}

/**
 * Screenshots of the app's main states for visual review: pnpm screens, then look in screens/.
 * Not assertions about pixels: each step only checks enough to know the screenshot shows the right thing.
 */

/** Problems found on each screen, written to screens/<project>-audit.json for review. */
const findings: Record<string, string[]> = {};

/**
 * Checks the visible screen for what makes a phone layout feel broken: anything wider than the screen,
 * and controls too small to tap (under 40 x 40 px; text links are allowed 24 px tall). On every screen,
 * buttons side by side must be the same height.
 */
async function audit(page: Page, name: string) {
  findings[name] = await page.evaluate(() => {
    const issues: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) {
      issues.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px wide on a ${vw}px screen`);
    }
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
    // Finger-sized targets matter on touch screens; a mouse is precise enough for the desktop sizes.
    const touch = matchMedia('(pointer: coarse)').matches;
    for (const el of document.querySelectorAll('button, a, input, select, [role="option"], label.check')) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || !r.height || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      // Inside a strip that scrolls sideways (the edition covers), being past the edge is the point.
      let scroller = el.parentElement;
      while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
      const inScroller = scroller !== null && scroller !== document.documentElement && scroller !== document.body;
      if (r.right > vw + 1 && !inScroller) issues.push(`runs off the right edge: ${describe(el)} (right at ${Math.round(r.right)}px)`);
      if (inScroller && r.right > vw) continue;
      const isTextLink = el.matches('a, button.link');
      const minH = isTextLink ? 24 : 40;
      // Inputs inside a tappable label count as the label's size.
      const target = el.closest('label') && el.matches('input[type="checkbox"], input[type="radio"]') ? el.closest('label')!.getBoundingClientRect() : r;
      if (touch && (target.height < minH - 0.5 || (!isTextLink && target.width < 40 - 0.5))) {
        issues.push(`small tap target ${Math.round(target.width)}x${Math.round(target.height)}: ${describe(el)}`);
      }
    }
    // Controls on one line under one parent (buttons, text boxes, dropdowns, the file picker) must
    // match in height: a primary button next to a plain one, or a field next to its button.
    const groups = new Map<Element, DOMRect[]>();
    const controls = "button:not(.link), a.button, select, input[type='file'], input:is([type='text'], [type='email'], [type='number'], [type='date'], [type='url'], [type='search'])";
    for (const el of document.querySelectorAll(controls)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || !el.parentElement) continue;
      if (el.closest('.variant-strip')) continue;
      // A field inside a label is compared at the label's parent, beside the label's neighbours.
      const parent = el.matches('input, select') && el.parentElement.tagName === 'LABEL' ? el.parentElement.parentElement! : el.parentElement;
      groups.set(parent, [...(groups.get(parent) ?? []), r]);
    }
    for (const [parent, rects] of groups) {
      for (const a of rects) {
        for (const b of rects) {
          const sameLine = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 4;
          if (sameLine && Math.abs(a.height - b.height) > 1) {
            issues.push(`controls side by side differ in height (${Math.round(a.height)} vs ${Math.round(b.height)}px) in ${describe(parent)}`);
          }
        }
      }
    }
    return [...new Set(issues)];
  });
}

const started = Date.now();
const shot = async (page: Page, name: string) => {
  if (process.env.STEPS) console.log(`${test.info().project.name} ${name} at ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await page.screenshot({ path: `screens/${test.info().project.name}-${name}.png` });
  await audit(page, name);
};

test.afterAll(async () => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`screens/${test.info().project.name}-audit.json`, JSON.stringify(findings, null, 2));
});

/** On narrow screens the app shows one pane at a time; this opens one if the tab bar is there. */
async function openTab(page: Page, name: 'Setup' | 'Books' | 'Preview') {
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

/** Covers load from Open Library; give them a moment so screenshots show real covers. */
const settle = (page: Page, ms = 2500) => page.waitForTimeout(ms);

test.beforeEach(async ({ page }) => {
  await cacheOpenLibrary(page);
  // Test runs aren't visitors: the analytics script never loads here (and refuses localhost anyway).
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  // Script errors and console errors belong in the audit too: a blank screen is often one of these.
  const errors: string[] = (findings['errors'] = []);
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || /webgl/i.test(m.text())) errors.push(`console ${m.type()}: ${m.text().slice(0, 200)}`);
  });
  // The same sample every run, so screenshots can be compared before and after a change.
  await page.addInitScript(() => {
    let seed = 42;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Mini Book Labels' })).toBeVisible();
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
  // Like a person with a mouse: onto the strip first, so the fan spreads and settles (200 ms), then
  // the click. Jumping straight to a cover lands mid-spread, on whichever cover has just moved there.
  await variants.first().hover();
  await page.waitForTimeout(400);
  await variants.nth(2).locator('button').click();
  await settle(page, 1500);
  await variants.nth(5).hover();
  await page.waitForTimeout(400);
  await page.locator('.variants').screenshot({ path: `screens/${test.info().project.name}-03b-variants.png` });

  // Full-wrap artwork, uploaded: the spine sliders and nudge buttons appear, and the preview shows it.
  const wrap = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 600;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2c4a6e';
    g.fillRect(0, 0, 900, 600);
    g.fillStyle = '#e8c547';
    g.fillRect(400, 0, 100, 600);
    g.fillStyle = '#fff';
    g.font = 'bold 60px sans-serif';
    g.fillText('BACK', 120, 300);
    g.fillText('FRONT', 580, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel(/Image is the full wrap/).check();
  await page.locator('.cover-edit input[type="file"]').setInputFiles({
    name: 'wrap.png',
    mimeType: 'image/png',
    buffer: Buffer.from(wrap, 'base64'),
  });
  await expect(page.getByText(/Spine width/)).toBeVisible({ timeout: 10_000 });
  // The panel redraws as spine detection finishes, so the label can be swapped mid-scroll: retry.
  await expect(async () => page.getByText(/Spine width/).scrollIntoViewIfNeeded({ timeout: 1000 })).toPass();
  await settle(page, 800);
  await shot(page, '03c-wrap-align');

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

test('guide', async ({ page }) => {
  await page.goto('./mini-book-ornaments/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, '08-guide');
  await page.getByRole('heading', { name: 'Mini book sizes' }).evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await shot(page, '09-guide-sizes');

  await page.goto('./year-in-books-ornament/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, '10-year-in-books');
});

test('blank books page', async ({ page }) => {
  await page.goto('./blank-books/');
  await expect(page.getByRole('heading', { name: 'Blank mini books, 3D printed to order' })).toBeVisible();
  await shot(page, '08b-blank-books');
  await page.locator('table').scrollIntoViewIfNeeded();
  await shot(page, '08c-blank-books-prices');
});

test('opened order', async ({ page }) => {
  // What the seller sees after pasting an order code from Stripe onto the site address.
  await page.goto('./#order=v1-h175-w117-s29-round-hook-spine-back');
  await expect(page.getByText(/Order .* is loaded below/)).toBeVisible();
  await expect(page.getByLabel('Ornament hook on top')).toBeChecked();
  await expect(page.getByLabel('Slightly rounded spine (flat prints best)')).toBeChecked();
  await expect(page.getByLabel('Flush with')).toHaveValue('back');
  await page.getByText(/Order .* is loaded below/).scrollIntoViewIfNeeded();
  await shot(page, '11-opened-order');

  await page.goto('./thanks/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, '12-thanks');
});

test('shop preview', async ({ page }) => {
  // The printed-books panel, hidden until checkout is live; ?shop=preview shows it for review.
  await page.goto('./?shop=preview');
  await expect(page.getByRole('heading', { name: 'Mini Book Labels' })).toBeVisible();
  await openTab(page, 'Setup');
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  await expect(page.locator('.book').first()).toBeAttached();
  await openTab(page, 'Setup');
  await page.locator('.buy-blanks').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, '13-shop-preview');

  // Ordering opens in its own tab, starting from the designer's book.
  const link = page.getByRole('link', { name: 'Order blanks' });
  await expect(link).toHaveAttribute('target', '_blank');
  await page.goto(`.${await link.getAttribute('href')}`);
  const form = page.locator('.order-page');
  await expect(page.getByRole('heading', { name: 'Order blanks' })).toBeVisible();
  await form.getByText('Black').click();
  await expect(form.getByText(/Drag to turn/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);
  await shot(page, '14-order-page');
  await form.locator('.price-detail summary').click();
  const proceed = form.getByRole('button', { name: 'Continue to shipping' });
  await form.getByLabel(/confirm the size and colour/).check();
  await form.getByLabel(/made to order/).check();
  await expect(proceed).toBeDisabled();
  await form.getByLabel(/small imperfections/).check();
  await expect(proceed).toBeEnabled();
  await expect(page).toHaveURL(/code=v1-[^&]*-c-black/);
  await proceed.scrollIntoViewIfNeeded();
  await shot(page, '15-order-confirmed');
});

/** Sample orders at each stage, so admin's screenshots don't depend on the local database. */
const ADMIN_ORDER = {
  order_code: 'v1-h300-w200-s50-flat-hook-center-front-c-black',
  description: '30 x 20 x 5 mm, black, flat spine, hook centred, front',
  amount_total: 2171,
  email: 'reader@example.com',
  address: { line1: '290 Bremner Blvd', city: 'Toronto', state: 'ON', postal_code: 'M5V 3L9', country: 'CA' },
  delivery: 'Standard',
  shipping_provider: 'chitchats',
  shipping_service: 'chit_chats_slim',
  shipping_amount: 448,
  shipment_provider: null,
  shipment_id: null,
  label_status: null,
  postage_type: null,
  label_cost: null,
  tracking_code: null,
  tracking_url: null,
  label_pdf_url: null,
  shipped_at: null,
  shipped_emailed_at: null,
  tracking_checked_at: null,
  delivered_at: null,
};
const LABELED = {
  shipment_provider: 'chitchats',
  shipment_id: 'P0000001',
  label_status: 'label',
  postage_type: 'chit_chats_slim',
  label_cost: 448,
  tracking_code: 'CC000000001CA',
  tracking_url: 'https://chitchats.com/tracking/p0000001',
  label_pdf_url: 'https://chitchats.com/labels/p0000001.pdf',
};
const ADMIN_ORDERS = [
  { ...ADMIN_ORDER, session_id: 'cs_1', name: 'Ada Lovelace', quantity: 5, status: 'paid', created_at: '2026-11-11 15:02:00' },
  { ...ADMIN_ORDER, session_id: 'cs_2', name: 'Grace Hopper', quantity: 12, status: 'printing', created_at: '2026-11-10 09:40:00' },
  { ...ADMIN_ORDER, ...LABELED, session_id: 'cs_3', name: 'Katherine Johnson', quantity: 3, status: 'labeled', created_at: '2026-11-09 18:15:00' },
  {
    ...ADMIN_ORDER,
    ...LABELED,
    session_id: 'cs_4',
    name: 'Mary Somerville',
    quantity: 8,
    status: 'shipped',
    label_status: 'in_transit',
    shipped_at: '2026-11-08 14:00:00',
    shipped_emailed_at: '2026-11-08 14:00:00',
    tracking_checked_at: '2026-11-11 12:00:00',
    created_at: '2026-11-06 11:20:00',
  },
  {
    ...ADMIN_ORDER,
    ...LABELED,
    session_id: 'cs_5',
    name: 'Emmy Noether',
    quantity: 2,
    status: 'delivered',
    label_status: 'delivered',
    shipped_at: '2026-11-03 10:00:00',
    shipped_emailed_at: '2026-11-03 10:00:00',
    delivered_at: '2026-11-06 16:30:00',
    tracking_checked_at: '2026-11-06 20:00:00',
    created_at: '2026-11-01 08:05:00',
  },
];

test('admin', async ({ page }) => {
  await page.route('**/api/admin/orders', (route) =>
    route.fulfill({ json: { orders: ADMIN_ORDERS, providers: [{ id: 'chitchats', name: 'Chit Chats', mode: 'test' }] } }),
  );
  await page.goto('./admin/');
  await expect(page.locator('.admin-row')).toHaveCount(2);
  await page.getByRole('tab', { name: /All/ }).click();
  await expect(page.locator('.admin-row')).toHaveCount(5);
  await shot(page, '17-admin-orders');

  // A new order: the step bar, the next step, and the 3D book as ordered.
  await page.locator('.admin-row', { hasText: 'Ada Lovelace' }).click();
  await expect(page.getByRole('button', { name: 'Start printing' })).toBeVisible();
  await expect(page.getByText(/Drag to turn/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, '18-admin-new-order');

  // A shipped order: its label and tracking.
  await page.locator('.admin-row', { hasText: 'Mary Somerville' }).click();
  await expect(page.getByRole('link', { name: 'Print label' })).toBeVisible();
  await page.locator('.admin-main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, '19-admin-shipped-order');
});

test('admin order link', async ({ page }) => {
  // The new-order email links to /admin/?order=<id>: that order opens, even when it's past the To do tab.
  await page.route('**/api/admin/orders', (route) =>
    route.fulfill({ json: { orders: ADMIN_ORDERS, providers: [{ id: 'chitchats', name: 'Chit Chats', mode: 'test' }] } }),
  );
  await page.goto('./admin/?order=cs_4');
  await expect(page.locator('.admin-title')).toHaveText('Mary Somerville');
  await expect(page.locator('.admin-row.active')).toContainText('Mary Somerville');
  await page.locator('.admin-row', { hasText: 'Emmy Noether' }).click();
  await expect(page).toHaveURL(/order=cs_5/);
});
