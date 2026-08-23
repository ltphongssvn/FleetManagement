// scripts/deps-reconcile-cli.test.ts
// RED (t82 deps-reconcile arc, 2026-08-04): the PURE parts of the
// deps:reconcile driver -- argv parsing and target assembly.
//
// WHY node:util parseArgs INSTEAD OF A HAND-ROLLED LOOP. parseArgs has been
// built into Node since 18.3 and stable since 20; this repo pins node >=22, so
// it costs nothing to adopt. The hand-rolled alternatives in this repo
// (parseCloseArgv's for-loop, and the first draft of this arc's resolveExecute
// using argv.includes) are the pattern it exists to retire, and both carry real
// defects rather than mere untidiness:
//
//   1. STRICT BY DEFAULT. An unknown flag THROWS. A hand-rolled parser silently
//      ignores it, so a typo like --exceute yields a confident no-op the
//      operator reads as a successful run. Silently swallowing an argument the
//      operator clearly meant is the confident-zero failure this repo refuses
//      everywhere else.
//   2. POSITIONALS ARE STRUCTURALLY SEPARATE. argv.includes('--execute') cannot
//      distinguish a flag from a value, so ['--only', '--execute'] reads as
//      consent to install across 45 worktrees. With parseArgs the path is a
//      positional and consent is a boolean option; the confusion is
//      unrepresentable rather than merely untested.
//   3. NO BESPOKE PARSING LOGIC SURVIVES. The config is declarative and Node
//      owns the loop, so there is nothing left to drift.
//
// resolveExecute is RETIRED with this slice. Two ways to determine consent is
// the duplication problem; its three tests are replaced by strictly more
// coverage here.
//
// WHAT STAYS UNTESTED, deliberately: the git listing and the pnpm probe, both
// thin wrappers over already-tested code (parseWorktreePorcelain has 5 tests in
// worktree-close.test.ts; probeDeps is the shared adapter). The sweep is
// covered by deps-reconcile-runner.test.ts with an injected spawn. What remains
// in main() is wiring too small to hide a defect.
import { describe, it, expect } from 'vitest';
import { buildTargets, parseReconcileArgv, type WorktreeListEntry } from './deps-reconcile-cli.js';
describe('parseReconcileArgv (consent is explicit and unforgeable)', () => {
  it('defaults to a dry run with no filter', () => {
    expect(parseReconcileArgv([])).toEqual({ execute: false, only: null, verbose: false });
  });
  it('accepts --execute as consent', () => {
    expect(parseReconcileArgv(['--execute']).execute).toBe(true);
  });
  it('does NOT treat an unrelated known flag as consent', () => {
    expect(parseReconcileArgv(['--verbose']).execute).toBe(false);
  });
  it('does NOT treat a positional path as consent', () => {
    const a = parseReconcileArgv(['/wt/a']);
    expect(
      a.execute,
      'a path argument must never imply permission to install; consent is a separate explicit flag',
    ).toBe(false);
    expect(a.only).toBe('/wt/a');
  });
  it('THROWS on an unknown flag rather than silently ignoring it', () => {
    expect(
      () => parseReconcileArgv(['--exceute']),
      'a silently ignored typo produces a no-op the operator reads as a successful run',
    ).toThrow();
  });
  it('THROWS on a near-miss of the consent flag specifically', () => {
    expect(() => parseReconcileArgv(['--execute=yes'])).toThrow();
  });
  it('is order-independent for flag and positional', () => {
    const expected = { execute: true, only: '/wt/a', verbose: false };
    expect(parseReconcileArgv(['--execute', '/wt/a'])).toEqual(expected);
    expect(parseReconcileArgv(['/wt/a', '--execute'])).toEqual(expected);
  });
  it('keeps the FIRST positional when several are given', () => {
    expect(parseReconcileArgv(['/wt/a', '/wt/b']).only).toBe('/wt/a');
  });
  it('reads --verbose independently of consent', () => {
    const a = parseReconcileArgv(['--verbose']);
    expect(a.verbose).toBe(true);
    expect(a.execute).toBe(false);
  });
});
const entries: WorktreeListEntry[] = [
  { path: '/wt/primary', branch: 'main' },
  { path: '/wt/a', branch: 'feature/a' },
  { path: '/wt/detached', branch: null },
];
// A stub probe: buildTargets must not care HOW a probe is obtained, only that
// each surviving worktree carries one. Injection mirrors the runner, so the
// expensive real probe is never needed to test the selection logic.
const stubProbe = (path: string): { kind: 'deps-ok' } | { kind: 'deps-stale'; reason: string } =>
  path === '/wt/a' ? { kind: 'deps-stale', reason: 'overrides changed' } : { kind: 'deps-ok' };
describe('buildTargets (which worktrees enter the sweep)', () => {
  it('pairs every worktree with its probe', () => {
    const t = buildTargets(entries, null, stubProbe);
    expect(t.map((x) => x.path)).toEqual(['/wt/primary', '/wt/a', '/wt/detached']);
  });
  it('carries the probe result through unchanged', () => {
    const t = buildTargets(entries, null, stubProbe);
    expect(t.find((x) => x.path === '/wt/a')?.probe).toEqual({
      kind: 'deps-stale',
      reason: 'overrides changed',
    });
  });
  it('narrows to a single worktree when a filter is given', () => {
    const t = buildTargets(entries, '/wt/a', stubProbe);
    expect(t.length).toBe(1);
    expect(t[0]?.path).toBe('/wt/a');
  });
  it('probes ONLY the filtered worktree, never the whole fleet', () => {
    const seen: string[] = [];
    buildTargets(entries, '/wt/a', (p) => {
      seen.push(p);
      return { kind: 'deps-ok' };
    });
    expect(
      seen,
      'a filtered run must not pay ~7.7s per worktree across 45 worktrees to reach one',
    ).toEqual(['/wt/a']);
  });
  it('THROWS on an unknown filter rather than silently sweeping nothing', () => {
    expect(
      () => buildTargets(entries, '/wt/nope', stubProbe),
      'an empty sweep from a typo would exit 0 and read as success',
    ).toThrow();
  });
  it('names the known roots in the error so the typo is fixable', () => {
    expect(() => buildTargets(entries, '/wt/nope', stubProbe)).toThrow(/wt\/a/);
  });
  it('includes a detached worktree: deps drift does not care about branches', () => {
    expect(buildTargets(entries, '/wt/detached', stubProbe).length).toBe(1);
  });
  it('is empty for an empty worktree list', () => {
    expect(buildTargets([], null, stubProbe)).toEqual([]);
  });
});
