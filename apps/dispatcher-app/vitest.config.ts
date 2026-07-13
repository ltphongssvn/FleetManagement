// apps/dispatcher-app/vitest.config.ts
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
      exclude: ['**/index.ts', '**/*.config.ts', '**/test/**'],
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
