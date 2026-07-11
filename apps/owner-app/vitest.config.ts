// apps/owner-app/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // token-storage.test.ts and api-url-web-origin.test.ts each mutate shared
    // globals (globalThis.localStorage / window). With few files they land in
    // the same parallel batch and leak into each other (driver-app carries the
    // identical tests but its larger suite schedules them apart). Serialize
    // file execution - the repo's sanctioned lever for racy specs - so each
    // file gets a clean global scope. Cheap here: this package is tiny.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
      exclude: ['**/index.ts', '**/*.config.ts', '**/test/**', 'src/observability/sentry-bootstrap.ts', 'src/polyfills/install-fetch-polyfill.ts', 'src/auth/use-auth.tsx', 'src/dashboard/use-adoption.tsx', 'src/theme/tokens.ts'],
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
