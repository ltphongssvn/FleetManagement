// apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    clearMocks: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.integration.test.ts', 'node_modules', 'dist'],
    // Raised from the 5s default: under the parallel 8-package turbo run,
    // CPU contention from heavy sibling files (pglite-smoke ~35s,
    // expo-push-provider ~37s) can starve light tests well past 5s.
    // app.module.test.ts imports the full Nest module graph (~4s isolated,
    // >30s when starved). 60s matches vitest.coverage.config.ts.
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
    },
  },
});
