// ============================================================================
// File:     FleetManagement/vitest.config.ts
// Purpose:  Root Vitest workspace config — enforces consistent coverage
//           thresholds and test conventions across all packages.
// Related:  turbo.jsonc (test:unit task), packages/*/vitest.config.ts
// ============================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['**/index.ts', '**/*.config.ts', '**/dist/**', '**/test/**'],
      provider: 'v8',
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
