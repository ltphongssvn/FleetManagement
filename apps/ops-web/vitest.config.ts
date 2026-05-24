// apps/ops-web/vitest.config.ts
// Vitest config for @fleet/ops-web. Covers src/features and src/lib (business logic).
// src/app contains routing/layout wireframes only - feature logic lives in src/features.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    // Raised from the 5s default: under the parallel 8-package turbo run,
    // jsdom render of Headless UI Combobox-heavy forms can exceed 5s purely
    // from CPU contention (passes in ~1s in isolation). Prevents flaky
    // timeouts in CI without masking real hangs.
    testTimeout: 30000,
    coverage: {
      exclude: ['**/index.ts', '**/types.ts', '**/*.config.{ts,mjs}', '**/dist/**', '**/.next/**', '**/test/**', 'src/app/**', '**/*.stories.tsx', '**/*.mock.ts'],
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.{ts,tsx}')],
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
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
