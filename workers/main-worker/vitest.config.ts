// workers/main-worker/vitest.config.ts
// Vitest config for @fleet/main-worker — unit tests for queue processors.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      exclude: ['**/index.ts', '**/*.config.ts', '**/dist/**', '**/test/**'],
      provider: 'v8',
      reportsDirectory: 'coverage/unit',
    },
  },
});
