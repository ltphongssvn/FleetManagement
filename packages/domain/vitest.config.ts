// packages/domain/vitest.config.ts
// Vitest config for @fleet/domain — unit tests for state machines + policies.
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
