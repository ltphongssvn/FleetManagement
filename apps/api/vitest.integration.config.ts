// apps/api/vitest.integration.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
    coverage: {
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
      exclude: [
        '**/index.ts',
        '**/main.ts',
        '**/*.module.ts',
        '**/*.controller.ts',
        '**/*.config.ts',
        '**/database/schema/**',
        '**/otel-bootstrap.ts',
        '**/dist/**',
        '**/test/**',
      ],
      reportsDirectory: 'coverage/unit',
      clean: false,
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        perFile: true,
      },
    },
  },
});
