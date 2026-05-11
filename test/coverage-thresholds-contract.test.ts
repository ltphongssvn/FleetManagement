// test/coverage-thresholds-contract.test.ts
// Contract: every Vitest coverage config must enforce minimum thresholds.
// Prevents accidental threshold removal that would silently lower the quality bar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIGS = [
  'apps/api/vitest.coverage.config.ts',
  'apps/ops-web/vitest.config.ts',
  'apps/driver-app/vitest.config.ts',
  'packages/domain/vitest.config.ts',
];

const MINIMUMS = { statements: 80, lines: 80, functions: 70, branches: 50 };

describe('coverage threshold contract', () => {
  for (const cfg of CONFIGS) {
    describe(cfg, () => {
      const src = readFileSync(resolve(__dirname, '..', cfg), 'utf8');

      it('declares a thresholds block', () => {
        expect(src).toMatch(/thresholds\s*:\s*\{/);
      });

      for (const [metric, min] of Object.entries(MINIMUMS)) {
        it('enforces ' + metric + ' >= ' + min, () => {
          const re = new RegExp(metric + '\\s*:\\s*(\\d+)');
          const m = src.match(re);
          expect(m, metric + ' threshold missing in ' + cfg).not.toBeNull();
          expect(Number(m![1])).toBeGreaterThanOrEqual(min);
        });
      }

      it('enables perFile enforcement (prevents averaging away weak files)', () => {
        expect(src).toMatch(/perFile\s*:\s*true/);
      });
    });
  }
});
