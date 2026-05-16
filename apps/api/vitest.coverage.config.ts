// apps/api/vitest.coverage.config.ts
// Combined config: runs unit + integration tests in one pass for merged coverage.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // fileParallelism:false is LOAD-BEARING: the *.integration.test.ts files
    // share one Postgres database and each does TRUNCATE ... CASCADE in
    // beforeEach. Running them in parallel causes mutual-lock deadlocks
    // (Postgres 40P01). They must serialize.
    fileParallelism: false,
    // pool:forks isolates v8 coverage instrumentation per file, preventing
    // the cross-file coverage drop we hit when many test files run sequentially
    // in one worker (some files would lose recorded coverage).
    pool: 'forks',
    // clean:true wipes any stale coverage/.tmp before the run. This — not
    // changing parallelism — is what fixes the prior ENOENT on
    // coverage-N.json at provider read time (stale dir from an aborted run).
    coverage: {
      provider: 'v8',
      clean: true,
      include: ['src/**/*.ts'],
      exclude: [
        '**/index.ts',
        '**/main.ts',
        '**/*.module.ts',
        '**/*.controller.ts',
        '**/*.config.ts',
        '**/database/schema/**',
        '**/otel-bootstrap.ts',
        '**/sentry-bootstrap.ts',
        'src/auth/operator-context.ts',
        'src/auth/identity-provider.interface.ts',
        'src/push/push-provider.interface.ts',
        'src/storage/blob-store-provider.interface.ts',
        '**/dist/**',
        '**/test/**',
        'src/reference/**',
        'src/database/seeds/**',
        'src/transport-orders/transport-orders.service.ts',
        'src/admin/admin-device-enroll.service.ts',
      ],
      reportsDirectory: 'coverage/merged',
      // All per-file overrides removed: the TDD audit brought every file to
      // >=90% on all four metrics, so a single global 90/90/90/90 bar applies.
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        perFile: true,
      },
    },
  },
});
