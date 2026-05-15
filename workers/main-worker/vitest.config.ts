// workers/main-worker/vitest.config.ts
// Vitest config for @fleet/main-worker — unit tests for queue processors.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      // erp-job.ts and outbox-routing.ts are pure re-export barrels of
      // schemas/policies/types owned by @fleet/sync-protocol (no own runtime
      // logic). v8 reports 0% because there is nothing original to instrument;
      // the re-exported code is tested in its owning package. Excluded like
      // **/index.ts barrels.
      exclude: [
        '**/index.ts',
        '**/main.ts',
        '**/*.config.ts',
        '**/dist/**',
        '**/test/**',
        '**/erp/erp-job.ts',
        '**/outbox/outbox-routing.ts',
      ],
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        perFile: true,
      },
      reportsDirectory: 'coverage/unit',
    },
  },
});
