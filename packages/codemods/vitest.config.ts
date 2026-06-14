// packages/codemods/vitest.config.ts
// Vitest config for @fleet/codemods — unit + fixture tests for ts-morph transforms
// and the workspace orchestrator. Coverage gates the transform/orchestrator logic;
// the CLI entrypoint (cli.ts) and barrel (index.ts) are excluded as no-logic wiring.
//
// Concurrency hardening (Vitest 4 + Turborepo). Each transform/orchestrator suite
// constructs a real ts-morph Project (the TypeScript compiler): ~1-2s alone, but it
// starves and times out when the whole monorepo runs concurrently under
// `turbo run __ci_fast__` (every package spawns its own pool -> CPU oversubscription;
// a documented Vitest-4-on-Turborepo failure mode). Fix per the Vitest 4 pool rework:
//   - pool 'forks' (explicit; the stable default since v2) for process isolation of
//     ts-morph's global compiler state.
//   - maxWorkers caps THIS package's in-pool parallelism so its CPU-heavy Project
//     construction does not stampede 6 files at once. (Vitest 4 removed maxForks/
//     maxThreads and consolidated them into the single top-level maxWorkers; the old
//     poolOptions.forks.* nesting no longer typechecks.)
//   - testTimeout 30s absorbs cold-start under cross-package contention with headroom,
//     while still failing fast on a genuine hang.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 30000,
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
