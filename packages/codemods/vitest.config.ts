// packages/codemods/vitest.config.ts
// Vitest config for @fleet/codemods — unit + fixture tests for ts-morph transforms
// and the workspace orchestrator. Coverage gates the transform/orchestrator logic;
// the CLI entrypoint (cli.ts) and barrel (index.ts) are excluded as no-logic wiring.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      exclude: ['**/index.ts', '**/cli.ts', '**/*.config.ts', '**/dist/**', '**/test/**'],
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
