// apps/api/vitest.coverage.config.ts
// Combined config: runs unit + integration tests in one pass for merged coverage.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/helpers/global-teardown.ts'],
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
      // 'json' emits coverage-final.json so sharded CI jobs can merge their
      // partial coverage; 'text' keeps the human-readable console table.
      reporter: ['text', 'json'],
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
        // Pure type-only file (two interfaces, zero runtime code) — v8
        // reports it as 0% because there is nothing to instrument.
        'src/reference/reference.dto.ts',
        '**/dist/**',
        '**/test/**',
      ],
      reportsDirectory: 'coverage/merged',
      // The 90/90/90/90 per-file gate is enforced only when
      // VITEST_ENFORCE_THRESHOLDS is set. CI shards each run a subset of test
      // files, so a perFile threshold applied per shard would fail on every
      // file that shard did not execute. Shards therefore run threshold-free;
      // the dedicated merge job sets the env var and enforces the gate once
      // on the merged coverage report. The local test:coverage script sets it
      // too, so developers running the full suite still get the gate.
      ...(process.env['VITEST_ENFORCE_THRESHOLDS']
        ? {
            thresholds: {
              statements: 90,
              branches: 90,
              functions: 90,
              lines: 90,
              perFile: true,
            },
          }
        : {}),
    },
  },
});
