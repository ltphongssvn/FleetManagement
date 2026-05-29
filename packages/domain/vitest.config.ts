// packages/domain/vitest.config.ts
// Vitest config for @fleet/domain — unit tests for state machines + policies.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      // operator-context.ts is a type-only file (single interface, no runtime
      // code). v8 reports 0% because there is nothing executable to instrument;
      // an import-only test would fake coverage without testing behavior.
      // Excluded as a genuine no-logic file, consistent with **/index.ts.
      exclude: [
        '**/index.ts',
        '**/*.config.ts',
        '**/dist/**',
        '**/test/**',
        '**/identity/operator-context.ts',
      ],
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
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
