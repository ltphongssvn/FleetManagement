// apps/api/test/pre-push-hooks-mirror-ci.test.ts
// Operational invariant: the local pre-push gate must mirror the remote
// CI coverage-gate job (.github/workflows/ci.yml#coverage-gate). The CI
// job invokes scripts/merge-coverage.mjs which enforces 90/90/90/90
// per-file on the merged coverage-final.json. Without an equivalent local
// hook, a developer can push a commit that passes locally but fails CI.
//
// Three invariants captured here:
//   1. The pre-commit-config.yaml references scripts/merge-coverage.mjs.
//   2. The hook entries that invoke test:coverage or merge-coverage MUST
//      NOT swallow real failures via the buggy pattern
//        '... && pnpm test:coverage || echo "Skipped"'
//      because bash evaluates this as (A && B) || C — a real vitest
//      threshold failure (exit 1) triggers echo (exit 0), so the hook
//      silently passes despite the failure. The legitimate skip case
//      (pre-scaffold / pnpm missing) must use an explicit guard + exit.
//   3. There must NOT be a separate plain 'pnpm-test-push' hook that
//      duplicates the canonical coverage hook. Running 'pnpm test' as
//      well as 'pnpm test:coverage' on pre-push (a) wastes ~10 minutes
//      per push and (b) re-exposes parallel-mode flakes (testcontainers
//      port-bind races, manifest concurrency races) that the coverage
//      config avoids via fileParallelism:false. CI itself only runs the
//      coverage config; the local mirror should match.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
const here = dirname(fileURLToPath(import.meta.url));
const yamlPath = resolve(here, '../../../.pre-commit-config.yaml');
const yaml = readFileSync(yamlPath, 'utf8');
describe('@fleet/api - local pre-push hooks mirror remote CI coverage gate', () => {
  it('invokes scripts/merge-coverage.mjs from a pre-push hook entry', () => {
    expect(yaml).toContain('scripts/merge-coverage.mjs');
  });
  it('does not swallow test:coverage or merge-coverage failures via the buggy echo Skipped pattern', () => {
    const offenders: string[] = [];
    for (const line of yaml.split('\n')) {
      if (!/test:coverage|merge-coverage/.test(line)) continue;
      if (/\|\|\s*echo\s+["]*Skipped/.test(line)) offenders.push(line.trim());
    }
    expect(offenders).toEqual([]);
  });
  it('does not define a separate plain pnpm-test-push hook (the coverage hook is the canonical pre-push test gate)', () => {
    expect(yaml).not.toMatch(/id:\s*pnpm-test-push\b/);
  });
});
