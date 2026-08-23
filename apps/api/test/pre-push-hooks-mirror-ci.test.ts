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
  // 2026 fix, RELOCATED not weakened. pnpm -r defaults to UNBOUNDED workspace
  // concurrency, fanning out every package test:coverage at once. The api
  // parallel project caps at maxWorkers per package, but summed across packages
  // this oversubscribes the host into CPU swap; testcontainers/PGlite hooks then
  // time out and the gate fails on CONTENTION, not regression.
  //
  // That bound now lives in scripts/gate-coverage.ts (coverageArgs), because the
  // hook stopped being an inline bash string: it streamed every workspace's
  // vitest output through pre-commit's captured pipe until the pipe filled and
  // the framework died with BlockingIOError [Errno 11], aborting pushes while
  // the tests were PASSING.
  //
  // ARCHITECTURE TESTS ARE STRUCTURAL; BEHAVIOUR BELONGS IN UNIT TESTS. This
  // guard asserts the CHAIN -- hook reaches the registered task, task maps to
  // the committed script -- and scripts/gate-coverage.test.ts asserts the argv
  // the script actually emits. The previous version string-matched YAML for
  // both, so relocating the invocation left the behavioural half no subject.
  //
  // NO CONDITIONAL LOGIC HERE, deliberately. A guard shaped as "if the YAML
  // still has the line, check it, else skip" stops asserting the moment the
  // shape changes -- which is the failure mode it exists to prevent.
  it('routes the coverage gate through the registered task, not an inline bash string', () => {
    const covHook = yaml.split(NL).find((l) => /entry:.*gate:coverage/.test(l));
    expect(covHook, 'pre-push coverage hook must invoke the gate:coverage task').toBeDefined();
    expect(
      covHook,
      'the hook must stay THIN: no inline flock/pnpm -r pipeline in YAML',
    ).not.toMatch(/flock|pnpm -r/);
  });
  it('maps gate:coverage to the committed script, so the argv is unit-testable', () => {
    const pkgPath = resolve(here, '../../../package.json');
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const scripts = (pkg as { scripts?: Record<string, string> }).scripts ?? {};
    expect(
      scripts['gate:coverage'],
      'gate:coverage must be a registered root script',
    ).toBeDefined();
    expect(scripts['gate:coverage']).toContain('scripts/gate-coverage.ts');
  });
  it('the gate script still bounds workspace concurrency (the invariant itself)', () => {
    const gatePath = resolve(here, '../../../scripts/gate-coverage.ts');
    const gate = readFileSync(gatePath, 'utf8');
    expect(
      gate,
      'unbounded pnpm -r fan-out oversubscribes the host and fails the gate on contention',
    ).toMatch(/--workspace-concurrency=1/);
  });
});
describe('@fleet/api - coverage config is a single all-parallel project on the shared container', () => {
  const cfgPath = resolve(here, '../vitest.coverage.config.ts');
  const cfg = readFileSync(cfgPath, 'utf8');
  // Strip // line comments and block comments so these structural assertions
  // inspect the ACTUAL config, not the prose that documents the prior design
  // (the header comment legitimately mentions projects/serial/fileParallelism).
  const cfgCode = cfg
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(NL)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join(NL);
  // Since the single-shared-container refactor, every file clones the migrated
  // template into its OWN database, so per-file isolation (not a serial project)
  // is what prevents cross-file interference. These assertions pin that design so
  // the old per-file-container parallel/serial split cannot silently return.
  it('wires the shared-container globalSetup chain (pg-global-setup before global-teardown)', () => {
    const setupIdx = cfg.indexOf('pg-global-setup.ts');
    const teardownIdx = cfg.indexOf('global-teardown.ts');
    expect(setupIdx).toBeGreaterThan(-1);
    expect(teardownIdx).toBeGreaterThan(-1);
    expect(setupIdx).toBeLessThan(teardownIdx);
  });
  it('does NOT split into a parallel/serial projects array (per-file DB isolation replaces it)', () => {
    expect(cfgCode).not.toMatch(/projects\s*:/);
    expect(cfgCode).not.toMatch(/name:\s*['"]serial['"]/);
  });
  it('does not force single-fork / fileParallelism:false over the whole suite', () => {
    expect(cfgCode).not.toMatch(/singleFork\s*:\s*true/);
    expect(cfgCode).not.toMatch(/fileParallelism\s*:\s*false/);
  });
  it('bounds maxWorkers so concurrent per-file pools stay under the container connection limit', () => {
    expect(cfgCode).toMatch(/maxWorkers\s*:\s*\d+/);
  });
});
