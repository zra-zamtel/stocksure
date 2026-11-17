import { defineConfig } from 'vitest/config';

// The core module is framework-free on purpose, so it can be tested in plain
// Node without React Native or Metro in the loop.
export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts'],
    environment: 'node',
  },
});
