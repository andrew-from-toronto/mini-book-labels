import { defineConfig, devices } from '@playwright/test';

/**
 * Browser runs of the real app, for looking at it: pnpm screens saves screenshots of the main states
 * at desktop, tablet and phone sizes into screens/ (not committed).
 */
/** WebGL for the 3D view in Chromium, in software where there is no GPU. Chromium-only flags. */
const chromium = { launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } };

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199/mini-book-labels/' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...chromium } },
    // Chromium with a tablet's size and touch.
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
        ...chromium,
      },
    },
    { name: 'phone', use: { ...devices['Pixel 7'], ...chromium } },
    { name: 'landscape', use: { ...devices['Pixel 7 landscape'], ...chromium } },
    // A desktop browser shrunk to phone width: mouse and hover, but the phone layout.
    { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 400, height: 860 }, ...chromium } },
    // WebKit, the engine behind every browser on iPhone and iPad. Known gap: on Windows, Playwright's
    // WebKit build shows the 3D view's canvas as blank in screenshots although the canvas holds the
    // drawn book (checked by reading its pixels back); check the 3D view on a real iPhone instead.
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
    { name: 'iphone-landscape', use: { ...devices['iPhone 15 landscape'] } },
    { name: 'ipad', use: { ...devices['iPad Mini'] } },
  ],
  webServer: {
    command: 'pnpm dev --port 5199 --strictPort',
    url: 'http://localhost:5199/mini-book-labels/',
    reuseExistingServer: true,
  },
});
