import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The core module is framework-free on purpose, so it can be tested in plain
// Node without React Native or Metro in the loop.
const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': src,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
