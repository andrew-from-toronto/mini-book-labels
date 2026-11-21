import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Names this build: the commit plus when it was built, so two builds of one commit still differ. */
const BUILD_ID = (() => {
  let commit = 'nogit';
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  return `${commit}-${Date.now().toString(36)}`;
})();

/** Writes /version.json next to the pages, which open tabs check for a newer build (src/lib/updates.ts). */
const versionFile = (): Plugin => ({
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    if (this.environment?.name !== 'client') return;
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
});

export default defineConfig({
  // Served at the root of minibookornaments.com.
  base: '/',
  // The Cloudflare plugin runs the Worker (worker/index.ts, for /api) inside Vite's dev server and builds
  // it alongside the site. Left out under Vitest, whose unit tests run in plain Node.
  plugins: process.env.VITEST ? [react()] : [react(), cloudflare(), versionFile()],
  // The build's id in the pages' code, to compare with /version.json. 'dev' while developing.
  define: { __BUILD_ID__: JSON.stringify(process.env.NODE_ENV === 'production' ? BUILD_ID : 'dev') },
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
