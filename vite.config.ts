import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/mini-book-labels/',
  plugins: [react()],
  // three.js is one ~550 kB chunk, loaded only when the 3D view opens; warn only above that.
  build: { chunkSizeWarningLimit: 600 },
  // Unit tests only; e2e/ holds Playwright's browser tests, run with pnpm screens.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
