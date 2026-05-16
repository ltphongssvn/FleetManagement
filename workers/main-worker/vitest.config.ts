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
      // 90/90/90/90 per-file: the mandated industry-standard minimum.
      // Previously 80 -- which let fetch-erp-client.ts pass at 83.33% branch
      // while violating the project-wide 90% bar. Raised to match root
      // vitest.config.ts and the other packages.
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
