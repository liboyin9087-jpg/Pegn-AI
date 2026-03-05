/**
 * vitest.config.ts — isolated test config that does NOT load PostCSS/Tailwind.
 * The main vite.config.ts is kept for production builds.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()], // No VitePWA, no PostCSS/Tailwind
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
    css: false,
  },
});
