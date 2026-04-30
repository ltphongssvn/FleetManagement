// packages/observability/vitest.config.ts
// Vitest config for @fleet/observability — unit tests for PII scrubber.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      exclude: ['**/index.ts', '**/*.config.ts', '**/dist/**', '**/test/**'],
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 100,
        lines: 95,
        perFile: true,
      },
      reportsDirectory: 'coverage/unit',
    },
  },
});
