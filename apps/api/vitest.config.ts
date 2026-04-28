// apps/api/vitest.config.ts
// Default config — unit tests only. Integration tests run via test:integration.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.integration.test.ts', 'node_modules', 'dist'],
    coverage: {
      exclude: ['**/index.ts', '**/*.config.ts', '**/dist/**', '**/test/**'],
      provider: 'v8',
      reportsDirectory: 'coverage/unit',
    },
  },
});
