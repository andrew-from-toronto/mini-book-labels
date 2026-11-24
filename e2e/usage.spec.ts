import { expect, test, type Page } from '@playwright/test';

/**
 * Usage events (src/lib/telemetry.ts, src/lib/usage.ts), the Feedback form, and admin's Usage and Feedback
 * views. Reports are read in the page, since Playwright's WebKit does not show a beacon's body to page.route.
 */

test.skip(({ isMobile }) => isMobile, 'Desktop layout only');

type Report = { event: string; data: Record<string, unknown> };

async function watchReports(page: Page): Promise<Report[]> {
  const reports: Report[] = [];
  await page.route('**/api/t', (route) => route.fulfill({ status: 204 }));
  await page.route('**/static.cloudflareinsights.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.exposeFunction('reportSent', (body: string) => reports.push(JSON.parse(body)));
  await page.addInitScript(() => {
    localStorage.setItem('telemetry', 'force');
    const send = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      void (data as Blob).text().then((t) => (window as unknown as { reportSent: (b: string) => void }).reportSent(t));
      return send(url, data);
    };
  });
  return reports;
}

test('reports a visit, books coming in, views and labels going out, under one visitor', async ({ page }) => {
  test.setTimeout(120_000);
  const reports = await watchReports(page);
  await page.goto('./');
  await expect.poll(() => reports.map((r) => r.event)).toContain('visit');
  await page.getByRole('button', { name: /Try a sample/ }).first().click();
  await expect.poll(() => reports.find((r) => r.event === 'library')?.data).toMatchObject({ how: 'sample' });
  await page.getByRole('button', { name: 'Tree' }).click();
  await expect.poll(() => reports.find((r) => r.event === 'view')?.data).toMatchObject({ view: 'tree' });
  await page.getByRole('group', { name: 'Preview' }).getByRole('button', { name: 'Print sheet' }).click();
  await page.getByRole('combobox', { name: 'Print with' }).selectOption('cricut');
  await page.getByRole('button', { name: 'Make Cricut images' }).click();
  await expect.poll(() => reports.find((r) => r.event === 'output')?.data, { timeout: 90_000 }).toMatchObject({ mode: 'cricut', ok: true, labels: expect.any(Number) });

  // Every report carries the same random visitor and session, and no book titles.
  const visitors = new Set(reports.map((r) => r.data.visitor));
  expect(visitors.size).toBe(1);
  expect([...visitors][0]).toMatch(/^[a-z0-9-]{8,40}$/);
  expect(new Set(reports.map((r) => r.data.session)).size).toBe(1);
  const titles = await page.locator('.book .book-text strong').allTextContents();
  const sent = JSON.stringify(reports);
  for (const t of titles) expect(sent).not.toContain(t);

  // The visitor goes into backups.
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up' }).click()]);
  const backup = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
  expect(backup.visitor.id).toBe([...visitors][0]);
});

test('sends feedback from the footer', async ({ page }) => {
  await watchReports(page);
  let body: Record<string, unknown> | null = null;
  await page.route('**/api/feedback', async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Feedback' }).click();
  const dialog = page.getByRole('dialog', { name: 'Feedback' });
  await dialog.getByLabel('Message').fill('The tree view is lovely.');
  await dialog.getByRole('textbox', { name: 'Email (optional)' }).fill('reader@example.com');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog).toContainText("Thanks, it's sent.");
  expect(body).toMatchObject({ message: 'The tree view is lovely.', email: 'reader@example.com', website: '', page: 'app' });
});

test('admin shows usage and feedback', async ({ page }) => {
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10) + ' 00:00:00';
  await page.route('**/api/admin/usage*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        days: 30,
        sections: [
          { id: 'outputs', title: 'Where labels went' },
          { id: 'library', title: 'How books came in' },
        ],
        results: {
          'total.visitors': [{ n: 412 }],
          'total.returning': [{ n: 96 }],
          'total.labels': [{ n: 3180 }],
          'total.coversFound': [{ n: 2700 }],
          'total.coversGenerated': [{ n: 300 }],
          'total.coversReplaced': [{ n: 180 }],
          'total.orders': [{ n: 7 }],
          'total.revenue': [{ n: 31500 }],
          'funnel.app': [{ n: 300 }],
          'funnel.books': [{ n: 180 }],
          'funnel.labels': [{ n: 95 }],
          'funnel.shop': [{ n: 40 }],
          'funnel.checkout': [{ n: 12 }],
          'funnel.paid': [{ n: 7 }],
          dailyLabels: [{ day: day(2), n: 120 }, { day: day(1), n: 340 }, { day: day(0), n: 80 }],
          dailyVisitors: [{ day: day(2), n: 30 }, { day: day(1), n: 55 }, { day: day(0), n: 21 }],
          outputs: [{ value: 'home', n: 70 }, { value: 'shop', n: 18 }, { value: 'cricut', n: 9 }],
          library: { error: 'Analytics Engine 422: bad query' },
          events: [{ event: 'visit', n: 1200, visitors: 412 }],
        },
      }),
    }),
  );
  await page.route('**/api/admin/feedback', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ feedback: [{ id: 1, created_at: '2026-11-23 12:00:00', message: 'Love it', email: null, page: 'app', device: 'phone', browser: 'Safari', build: null, country: 'CA', status: 'new' }] }),
    }),
  );
  await page.goto('./admin/?view=usage');
  await expect(page.locator('.usage-tile').first()).toContainText('3,180');
  await expect(page.locator('.usage-funnel tr')).toHaveCount(6);
  await expect(page.getByText('Analytics Engine 422: bad query')).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/admin-usage.png`, fullPage: true });
  await page.getByRole('link', { name: 'Feedback' }).click();
  await expect(page.getByText('Love it')).toBeVisible();
});
