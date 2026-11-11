import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served at the root of minibookornaments.com.
  base: '/',
  plugins: [react()],
  build: {
    // three.js is one ~550 kB chunk, loaded only when the 3D view opens; warn only above that.
    chunkSizeWarningLimit: 600,
    // The app, plus the static how-to guide that search engines can read without running the app.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        guide: resolve(import.meta.dirname, 'mini-book-ornaments/index.html'),
        yearInBooks: resolve(import.meta.dirname, 'year-in-books-ornament/index.html'),
      },
    },
  },
  // Unit tests only; e2e/ holds Playwright's browser tests, run with pnpm screens.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
