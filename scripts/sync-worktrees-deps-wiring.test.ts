// scripts/sync-worktrees-deps-wiring.test.ts
// Wiring guard: the pure cores in worktree-deps-status.ts are green, but
// nothing CALLS them. Until sync-worktrees.ts reports dependency state per
// worktree, drift stays invisible exactly where every worktree is already
// walked -- which is how the canonical root ran sync:worktrees itself on
// turbo 2.10.6 while both origin/main and origin/develop declared 2.10.7.
//
// SOURCE-CONTRACT guard, same trade as the driver-app notification boot
// wiring test: the shell shells out to git and pnpm across 37 worktrees and
// is not unit-runnable, so the guard asserts what the source MUST say. The
// behaviour it wires is already covered by worktree-deps-status.test.ts.
//
// Every assertion runs on COMMENT-STRIPPED source: this file pins symbols
// that are also NAMED in the prose above and in the implementation header,
// so a raw includes() would pass on documentation alone and the guard would
// stay green against an unwired script.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const NL = String.fromCharCode(10);
const code = (rel: string): string =>
  readFileSync(resolve(here, rel), 'utf8')
    .split(NL)
    .filter((l) => !l.trimStart().startsWith('//'))
    .join(NL);
const SYNC = 'sync-worktrees.ts';
describe('sync-worktrees wires dependency-drift detection', () => {
  it('imports both decision cores from the tested module', () => {
    const s = code(SYNC);
    expect(
      s.includes('worktree-deps-status.js'),
      'the cores must come from the unit-tested module, not be re-implemented in the shell',
    ).toBe(true);
    expect(s.includes('classifyDepsCandidate')).toBe(true);
    expect(s.includes('interpretDepsProbe')).toBe(true);
  });
  it('runs the cheap tier-1 filter before the expensive probe', () => {
    const s = code(SYNC);
    const t1 = s.indexOf('classifyDepsCandidate(');
    const t2 = s.indexOf('interpretDepsProbe(');
    expect(t1, 'tier 1 must be called').toBeGreaterThan(-1);
    expect(t2, 'tier 2 must be called').toBeGreaterThan(-1);
    expect(
      t1,
      'the probe costs ~7.7s per worktree; across 37 worktrees an unfiltered probe adds ~4.7 minutes to a 30s task',
    ).toBeLessThan(t2);
  });
  it('reads the pnpm workspace state file for the validation timestamp', () => {
    const s = code(SYNC);
    expect(s.includes('.pnpm-workspace-state-v1.json')).toBe(true);
    expect(s.includes('lastValidatedTimestamp')).toBe(true);
  });
  it('derives manifest paths from the git worktree path, never from state-file keys', () => {
    const s = code(SYNC);
    expect(
      s.includes('projects'),
      'the projects map holds ABSOLUTE paths that survive a git worktree move and then point at a directory that no longer exists',
    ).toBe(false);
  });
  it('probes with the pnpm verify flag rather than a bare install', () => {
    const s = code(SYNC);
    expect(
      s.includes('--config.verifyDepsBeforeRun=error'),
      'the probe reuses pnpm own checkDepsStatus without changing the repo-wide setting',
    ).toBe(true);
  });
  it('NEVER installs: sync must report drift, not heal it', () => {
    const s = code(SYNC);
    expect(
      s.includes('install --force') || s.includes('--frozen-lockfile'),
      'an implicit install across 37 worktrees on a 9.7GiB box is destructive; the operator decides when to install',
    ).toBe(false);
  });
  it('counts drift in the run summary so it is measurable', () => {
    const s = code(SYNC);
    expect(s.includes('depsStale')).toBe(true);
  });
  it('keeps drift NON-FATAL while adoption ratchets', () => {
    const s = code(SYNC);
    expect(
      s.includes('t.blocked > 0 ? 1 : 0'),
      'stage 1 reports only; failing 37 drifted worktrees at once would block every terminal on the box',
    ).toBe(true);
  });
});
