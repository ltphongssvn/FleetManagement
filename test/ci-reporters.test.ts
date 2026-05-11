// test/ci-reporters.test.ts
// TDD RED: CI workflow must use structured reporters for PR annotations.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CI workflow uses structured Vitest reporters', () => {
  const ci = readFileSync(resolve(__dirname, '../.github/workflows/ci.yml'), 'utf8');

  it('uses github-actions reporter for inline PR annotations', () => {
    expect(ci).toMatch(/reporter=github-actions|reporter\s+github-actions/);
  });

  it('emits JSON output for coverage diff bots', () => {
    expect(ci).toMatch(/reporter=json|outputFile.*\.json/);
  });
});
