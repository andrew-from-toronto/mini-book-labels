import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served at the root of minibookornaments.com.
  base: '/',
  // The Cloudflare plugin runs the Worker (worker/index.ts, for /api) inside Vite's dev server and builds
  // it alongside the site. Left out under Vitest, whose unit tests run in plain Node.
  plugins: process.env.VITEST ? [react()] : [react(), cloudflare()],
  build: {
    // three.js is one ~550 kB chunk, loaded only when the 3D view opens; warn only above that.
    chunkSizeWarningLimit: 600,
  },
  environments: {
    // The pages, for the browser build only (the Worker has its own build): the app, the static guides
    // search engines can read without running it, ordering, and the after-checkout page.
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(import.meta.dirname, 'index.html'),
            guide: resolve(import.meta.dirname, 'mini-book-ornaments/index.html'),
            yearInBooks: resolve(import.meta.dirname, 'year-in-books-ornament/index.html'),
            order: resolve(import.meta.dirname, 'order/index.html'),
            model: resolve(import.meta.dirname, 'model/index.html'),
            admin: resolve(import.meta.dirname, 'admin/index.html'),
            thanks: resolve(import.meta.dirname, 'thanks/index.html'),
            about: resolve(import.meta.dirname, 'about/index.html'),
            blankBooks: resolve(import.meta.dirname, 'blank-books/index.html'),
          },
        },
      },
    },
  },
  // Unit tests only; e2e/ holds Playwright's browser tests, run with pnpm screens.
  test: { environment: 'node', include: ['src/**/*.test.ts', 'worker/**/*.test.ts'] },
});
