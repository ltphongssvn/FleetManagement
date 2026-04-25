// apps/api/vitest.config.ts
// Vitest config for @fleet/api — unit tests for controllers, services, gateways.
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
