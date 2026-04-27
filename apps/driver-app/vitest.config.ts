// apps/driver-app/vitest.config.ts
// Vitest config for @fleet/driver-app — unit tests for pure logic only.
// Component tests via React Native Testing Library deferred to week 4+.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      exclude: ['**/index.ts', '**/*.config.ts', '**/dist/**', '**/test/**', 'app/**'],
      provider: 'v8',
      reportsDirectory: 'coverage/unit',
    },
  },
});
