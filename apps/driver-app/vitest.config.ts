// apps/driver-app/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // pool 'forks' (the stable default since v2) plus an explicit worker cap.
    // driver-app is node-env and cheap PER worker, but with no cap it still
    // opens host-core forks; under parallel-worktree load (~21 workers on an
    // 8-core box) that oversubscription starved token-storage and the SYNC
    // vn-locale-date-us Intl call into the 5000ms default (observed 2026-07-17,
    // green 9/9 in 1.66s isolated). 2 matches apps/api and packages/codemods --
    // the repo's established value, not one invented here. testTimeout is left
    // at the vitest default deliberately: raising a budget is the treadmill
    // 9710dd8 locked as an anti-pattern; bounding the pool is the fix.
    // vitest-maxworkers-ssot.guard.test.ts keeps this from drifting back.
    pool: 'forks',
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
      exclude: ['**/index.ts', '**/*.config.ts', '**/test/**', '**/schema.ts', 'src/storage/sqlite-sync-store.ts', 'src/storage/migrate.ts', 'src/sync/fetch-sync-transport.ts', 'src/storage/native-bootstrap.ts', 'src/storage/native-bootstrap.web.ts', 'src/storage/sqlite-sync-store.web.ts', 'src/storage/migrate.web.ts', 'src/observability/sentry-bootstrap.ts', 'src/polyfills/install-fetch-polyfill.ts', 'src/auth/use-auth.tsx', 'src/assignments/use-trip-history.tsx', 'src/assignments/use-assignments.tsx', 'src/theme/tokens.ts'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        perFile: true,
      },
      reportsDirectory: 'coverage/unit',
    },
  },
});
