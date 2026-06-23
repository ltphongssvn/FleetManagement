// apps/api/vitest.coverage.config.ts
// Combined config: runs unit + integration tests in one pass for merged coverage.
//
// Parallelism (2026): a SINGLE all-parallel project. The previous parallel/serial
// split existed because the suite used a PER-FILE Postgres testcontainer model:
// testcontainer specs raced on host port binds, and specs that TRUNCATE shared
// tables / use multiple real connections interfered when run concurrently, so
// those were pinned to a serial (maxWorkers:1, fileParallelism:false, 180s hook)
// project.
//
// The single-shared-container refactor eliminated BOTH races structurally:
//   * ONE Postgres container is started in globalSetup (pg-global-setup.ts),
//     before any worker -> no per-file container, no per-file host port bind.
//   * each test file clones a migrated template into its OWN database
//     (CREATE DATABASE <name> TEMPLATE fleet_test_template, ~10ms) -> every file
//     operates on an ISOLATED database, so TRUNCATE / multi-connection / collision
//     specs cannot interfere across files.
// With per-file database isolation there is no remaining reason to serialize, so
// SERIAL_SPECS and the serial project are removed. Container startup is paid once
// in globalSetup (off every per-file beforeAll critical path), so the default 60s
// hook budget is ample (a per-file beforeAll now just clones, it does not start a
// container). maxWorkers stays bounded so concurrent per-file pools never approach
// the container max_connections under the pnpm -r full-workspace coverage run.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/helpers/pg-global-setup.ts', './test/helpers/global-teardown.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // pool:forks isolates v8 coverage instrumentation per file, preventing the
    // cross-file coverage drop seen when many files share one worker.
    pool: 'forks',
    // Single all-parallel project (per-file database isolation makes the
    // testcontainer specs safe to run concurrently). maxWorkers is set to 1 on
    // purpose: this suite mixes TWO heavy database strategies in one pool -
    // real-Postgres specs that bootstrap a full Nest app + open connections, and
    // PGlite specs that boot a Postgres-compiled-to-WASM instance per file. When
    // two max-weight files (especially two concurrent PGlite WASM boots) run at
    // once on a resource-constrained host, CPU contention stretches each WASM
    // boot until the beforeAll budget is exceeded and the run melts down (a
    // documented PGlite-under-contention failure mode). The old serial project
    // masked this by phase-separating the workloads; with that removed, bounding
    // the pool to 1 is what prevents the oversubscription. This is NOT the
    // unbounded per-file-container timeout treadmill we eliminated earlier: the
    // shared container is started ONCE in globalSetup, so a serial run still only
    // pays a ~10ms template clone per file (no per-file container start). Raise
    // to 2+ only on a well-resourced CI runner that can absorb concurrent boots.
    include: ['test/**/*.test.ts'],
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      clean: true,
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
        'src/reference/reference.dto.ts',
        '**/dist/**',
        '**/test/**',
      ],
      reportsDirectory: 'coverage/merged',
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
