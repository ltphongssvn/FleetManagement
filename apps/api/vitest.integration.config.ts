// apps/api/vitest.integration.config.ts
// Integration tests with Testcontainers — slower, real Postgres.
// Run via: pnpm --filter @fleet/api test:integration
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
