// apps/api/test/manifest.controller-binding.test.ts
// RED: ManifestController must derive OperatorContext from request via
// OperatorContextFactory, not import PILOT_OPERATOR_CONTEXT.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

describe('@fleet/api - ManifestController auth binding', () => {
  it('does not import PILOT_OPERATOR_CONTEXT directly', () => {
    const source = readFileSync(
      resolve(here, '../src/manifest/manifest.controller.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/PILOT_OPERATOR_CONTEXT/);
  });

  it('imports OperatorContextFactory', () => {
    const source = readFileSync(
      resolve(here, '../src/manifest/manifest.controller.ts'),
      'utf-8',
    );
    expect(source).toMatch(/OperatorContextFactory/);
  });
});
