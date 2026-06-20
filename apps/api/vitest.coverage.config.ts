// apps/api/vitest.coverage.config.ts
// Combined config: runs unit + integration tests in one pass for merged coverage.
//
// Parallelism (T6-PERF, 2026): Vitest v4 `projects` split. The 40 service/
// integration specs that build a PER-FILE in-memory PGlite and use
// withTxIsolation (transaction rollback, single connection) are fully
// isolated across files, so they run PARALLEL. A minority of specs are racy
// under parallel execution and MUST serialize:
//   * testcontainers specs race on host port binds;
//   * specs that TRUNCATE shared tables / use multiple real connections
//     (concurrency + cancel + schema + wipe + migrations) deadlock or
//     interfere when run concurrently.
// Those are pinned to a SERIAL project (maxWorkers:1). Previously the whole
// suite ran fileParallelism:false single-fork, costing ~21min; the split
// restores the ~5-6min CI budget without re-exposing the races.
import { defineConfig } from 'vitest/config';
// Racy specs that must run serially (testcontainers port binds + multi-
// connection / TRUNCATE shared-state interference). Everything else is
// per-file PGlite + withTxIsolation and is safe to parallelize.
const SERIAL_SPECS = [
  'test/admin-assignment.service.test.ts',
  'test/admin-device-enroll.service.test.ts',
  'test/admin-drivers-list.service.test.ts',
  'test/admin-drivers-update.service.test.ts',
  'test/append-tri-write.test.ts',
  'test/commands.controller.concurrency.integration.test.ts',
  'test/commands.controller.integration.test.ts',
  'test/commands.controller.tenant-policy.integration.test.ts',
  'test/device-enrollment.service.test.ts',
  'test/device.service.integration.test.ts',
  'test/dispatch.controller.integration.test.ts',
  'test/driver-me.service.test.ts',
  'test/erp.schema.integration.test.ts',
  'test/manifest.commit-finalize.parallel.test.ts',
  'test/manifest.finalize.rejection-and-state-guard.test.ts',
  'test/manifest.find-or-create.race.test.ts',
  'test/manifest.negotiate-stop-association.integration.test.ts',
  'test/manifest.service.concurrency.test.ts',
  'test/manifest.service.integration.test.ts',
  'test/migrations.integration.test.ts',
  'test/outbox-relay.service.integration.test.ts',
  'test/pre-push-hooks-mirror-ci.test.ts',
  'test/projection-runner.service.integration.test.ts',
  'test/sync.service.integration.test.ts',
  'test/transport-orders-export.labels.integration.test.ts',
  'test/transport-orders-export.service.integration.test.ts',
  'test/transport-orders.service.concurrency.test.ts',
  'test/transport-orders.service.full-fields.integration.test.ts',
  'test/transport.schema.integration.test.ts',
  'test/vitest-global-teardown-cleans-testcontainers.test.ts',
  'test/wipe-business-data.empty.test.ts',
  'test/wipe-business-data.integration.test.ts',
];
export default defineConfig({
  test: {
    globalSetup: ['./test/helpers/global-teardown.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // pool:forks isolates v8 coverage instrumentation per file, preventing
    // the cross-file coverage drop we hit when many files share one worker.
    pool: 'forks',
    projects: [
      {
        // PARALLEL: per-file PGlite + withTxIsolation specs. Fully isolated
        // across files, so they run concurrently for the bulk of the speedup.
        extends: true,
        test: {
          name: 'parallel',
          include: ['test/**/*.test.ts'],
          exclude: SERIAL_SPECS,
          // Bounded to 4 workers (CI shard model). Unbounded oversubscribes
          // CPU when the pre-push hook runs all workspace packages'
          // test:coverage concurrently (pnpm -r), starving workers and
          // timing out the testcontainers specs.
          maxWorkers: 2,
        },
      },
      {
        // SERIAL: testcontainers + TRUNCATE / multi-connection specs.
        // maxWorkers:1 serializes them to avoid port-bind + lock races.
        extends: true,
        test: {
          name: 'serial',
          include: SERIAL_SPECS,
          maxWorkers: 1,
          fileParallelism: false,
          // Testcontainers start + reuse handshake + drizzle migrate runs in
          // beforeAll. Under heavy load (pnpm -r runs every package's coverage
          // concurrently, ~680s wall), the default/60s hook budget is exceeded
          // and the run flakes on a container-start timeout. 180s gives the
          // shared reused container headroom without masking real hangs.
          hookTimeout: 180_000,
          testTimeout: 120_000,
        },
      },
    ],
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
