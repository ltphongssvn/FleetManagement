// apps/driver-app/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
      exclude: ['**/index.ts', '**/*.config.ts', '**/test/**', '**/schema.ts', 'src/storage/sqlite-sync-store.ts', 'src/storage/migrate.ts', 'src/sync/fetch-sync-transport.ts', 'src/storage/native-bootstrap.ts', 'src/storage/native-bootstrap.web.ts', 'src/storage/sqlite-sync-store.web.ts', 'src/storage/migrate.web.ts', 'src/observability/sentry-bootstrap.ts', 'src/auth/use-auth.tsx', 'src/assignments/use-trip-history.tsx', 'src/theme/tokens.ts'],
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
