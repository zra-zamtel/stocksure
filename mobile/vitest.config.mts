import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The core module is framework-free on purpose, so it can be tested in plain
// Node without React Native or Metro in the loop. The data layer runs against
// real SQLite through node:sqlite (src/test/sqlite.ts).
const src = fileURLToPath(new URL('./src', import.meta.url));

const shared = {
  resolve: { alias: { '@': src } },
};

const base = {
  environment: 'node' as const,
  setupFiles: ['src/test/setup.ts'],
};

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          ...base,
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts', 'src/**/*.system.test.ts'],
        },
      },
      {
        ...shared,
        test: { ...base, name: 'integration', include: ['src/**/*.integration.test.ts'] },
      },
      {
        ...shared,
        test: { ...base, name: 'system', include: ['src/**/*.system.test.ts'] },
      },
    ],
  },
});
