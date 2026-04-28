// apps/api/vitest.integration.config.ts
// Integration tests with Testcontainers - real Postgres.
// Serial execution (one suite at a time) prevents cross-suite deadlocks
// when multiple suites share a reused container.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
