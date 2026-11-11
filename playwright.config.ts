import { defineConfig, devices } from '@playwright/test';

/**
 * Browser runs of the real app, for looking at it: pnpm screens saves screenshots of the main states
 * at desktop, tablet and phone sizes into screens/ (not committed).
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199/mini-book-labels/',
    // WebGL for the 3D view, in software where there is no GPU.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Chromium with a tablet's size and touch, since the iPad profile needs WebKit.
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm dev --port 5199 --strictPort',
    url: 'http://localhost:5199/mini-book-labels/',
    reuseExistingServer: true,
  },
});
