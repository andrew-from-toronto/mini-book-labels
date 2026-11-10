import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/mini-book-labels/',
  plugins: [react()],
  test: { environment: 'node' },
});
