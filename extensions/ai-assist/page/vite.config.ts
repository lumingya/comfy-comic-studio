import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
});
