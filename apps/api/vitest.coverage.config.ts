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
        'src/driver/driver-me.service.ts',
        'src/device/device-enrollment.service.ts',
        'src/admin/admin-drivers-list.service.ts',
        'src/admin/admin-assignment.service.ts',
        'src/admin/admin-device-enroll.service.ts',
      ],
      reportsDirectory: 'coverage/merged',
      thresholds: {
        statements: 80,
        branches: 50,
        functions: 70,
        lines: 80,
        perFile: true,
        'src/auth/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/commands/command-policy.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/commands/command.dto.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/common/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/database/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/device/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/manifest/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/storage/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/sync/sync.dto.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/observability/otel.ts': { statements: 80, branches: 50, functions: 80, lines: 80 },
        'src/outbox/outbox-relay.service.ts': { statements: 80, branches: 70, functions: 80, lines: 80 },
        'src/projections/projection-runner.service.ts': { statements: 80, branches: 70, functions: 80, lines: 80 },
        'src/push/expo-push-provider.ts': { statements: 80, branches: 80, functions: 70, lines: 80 },
        'src/commands/commands.gateway.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
