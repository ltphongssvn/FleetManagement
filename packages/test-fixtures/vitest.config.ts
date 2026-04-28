// packages/test-fixtures/vitest.config.ts
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
