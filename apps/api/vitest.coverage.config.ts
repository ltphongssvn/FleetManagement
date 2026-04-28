// apps/api/vitest.coverage.config.ts
// Combined config: runs unit + integration tests in one pass for merged coverage.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
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
      reportsDirectory: 'coverage/merged',
      thresholds: {
        // Lowest acceptable per-file thresholds (global floor).
        statements: 80,
        branches: 50,
        functions: 70,
        lines: 80,
        perFile: true,
        // Stricter thresholds for pure logic / non-glue source code:
        'src/auth/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/commands/command-policy.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/commands/command.dto.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/common/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/database/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/device/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/manifest/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/storage/**/*.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/sync/sync.dto.ts': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
});
