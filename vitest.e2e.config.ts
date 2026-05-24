// vitest.e2e.config.ts
// Root e2e config — runs docker-compose smoke tests. Excluded from default `pnpm test`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
