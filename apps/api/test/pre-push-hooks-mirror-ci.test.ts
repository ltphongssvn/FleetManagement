// apps/api/test/pre-push-hooks-mirror-ci.test.ts
// Operational invariant: the local pre-push gate must mirror the remote
// CI coverage-gate job. Without an equivalent local hook, a developer can
// push a commit that passes locally but fails CI.
//
// Four invariants:
//   1. pre-commit-config.yaml references scripts/merge-coverage.mjs.
//   2. test:coverage / merge-coverage entries do NOT swallow failures.
//   3. No separate plain pnpm-test-push hook.
//   4. The coverage hook bounds pnpm workspace concurrency so summed
//      Vitest workers across packages cannot oversubscribe the host.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
const here = dirname(fileURLToPath(import.meta.url));
const yamlPath = resolve(here, '../../../.pre-commit-config.yaml');
const yaml = readFileSync(yamlPath, 'utf8');
const NL = String.fromCharCode(10);
describe('@fleet/api - local pre-push hooks mirror remote CI coverage gate', () => {
  it('invokes scripts/merge-coverage.mjs from a pre-push hook entry', () => {
    expect(yaml).toContain('scripts/merge-coverage.mjs');
  });
  it('does not swallow test:coverage or merge-coverage failures via the buggy echo Skipped pattern', () => {
    const offenders: string[] = [];
    for (const line of yaml.split(NL)) {
      if (/test:coverage|merge-coverage/.test(line)) {
        if (/[|][|]\s*echo\s+["]*Skipped/.test(line)) offenders.push(line.trim());
      }
    }
    expect(offenders).toEqual([]);
  });
  it('does not define a separate plain pnpm-test-push hook (the coverage hook is the canonical pre-push test gate)', () => {
    expect(yaml).not.toMatch(/id:\s*pnpm-test-push\b/);
  });
  // 2026 fix: pnpm -r defaults to UNBOUNDED workspace concurrency, fanning
  // out every package test:coverage at once. The api parallel project caps
  // at maxWorkers per package, but summed across packages this oversubscribes
  // the host into CPU swap; testcontainers/PGlite hooks then time out and the
  // gate fails on contention, not regression. Bound the workspace fan-out.
  it('bounds pnpm workspace concurrency on the coverage hook to avoid CPU starvation', () => {
    const covLine = yaml.split(NL).find((l) => /pnpm -r .*test:coverage/.test(l));
    expect(covLine, 'coverage hook entry must exist').toBeDefined();
    expect(covLine).toMatch(/--workspace-concurrency[= ]1\b/);
  });
});
describe('@fleet/api - coverage config parallelizes safe specs, serializes racy ones', () => {
  const cfgPath = resolve(here, '../vitest.coverage.config.ts');
  const cfg = readFileSync(cfgPath, 'utf8');
  it('defines vitest projects to separate parallel vs serial suites', () => {
    expect(cfg).toMatch(/projects\s*:/);
  });
  it('keeps a serial (maxWorkers:1) project for the racy specs', () => {
    expect(cfg).toMatch(/maxWorkers\s*:\s*1/);
  });
  it('runs a PARALLEL project (does not force single-fork over the whole suite)', () => {
    expect(cfg).toMatch(/name:\s*['"]parallel['"]/);
    expect(cfg).not.toMatch(/singleFork\s*:\s*true/);
  });
});
