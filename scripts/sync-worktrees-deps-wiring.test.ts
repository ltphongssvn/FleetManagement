// scripts/sync-worktrees-deps-wiring.test.ts
// Wiring guard: the pure cores in worktree-deps-status.ts are green, but
// nothing CALLS them. Until sync-worktrees.ts reports dependency state per
// worktree, drift stays invisible exactly where every worktree is already
// walked -- which is how the canonical root ran sync:worktrees itself on
// turbo 2.10.6 while both origin/main and origin/develop declared 2.10.7.
//
// SOURCE-CONTRACT guard, same trade as the driver-app notification boot
// wiring test: the shell shells out to git and pnpm across 45 worktrees and
// is not unit-runnable, so the guard asserts what the source MUST say. The
// behaviour it wires is already covered by worktree-deps-status.test.ts.
//
// Every assertion runs on COMMENT-STRIPPED source: this file pins symbols
// that are also NAMED in the prose above and in the implementation header,
// so a raw includes() would pass on documentation alone and the guard would
// stay green against an unwired script.
//
// UPDATED (t82, 2026-08-04): tier 2 moved OUT of this file. deps:reconcile
// became a second shell needing the same probe, and the two alternatives were
// both wrong -- copying it would duplicate three hard-won fixes so the next
// pnpm change repairs one copy and silently leaves the other, and exporting it
// from this git-sync module would make a pnpm probe reachable only through a
// git tool. It now lives in worktree-deps-probe.ts, the one adapter both
// shells wrap. Three assertions below followed the probe to its new home
// rather than being deleted, and a fourth was ADDED that the old arrangement
// could not express: this file must NOT re-implement the probe locally.
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
const PROBE = 'worktree-deps-probe.ts';
describe('sync-worktrees wires dependency-drift detection', () => {
  it('imports the tier-1 core from the tested module', () => {
    const s = code(SYNC);
    expect(
      s.includes('worktree-deps-status.js'),
      'the cores must come from the unit-tested module, not be re-implemented in the shell',
    ).toBe(true);
    expect(s.includes('classifyDepsCandidate')).toBe(true);
  });
  it('delegates tier 2 to the shared adapter instead of owning it', () => {
    const s = code(SYNC);
    expect(
      s.includes('worktree-deps-probe.js'),
      'deps:reconcile needs the same probe; one adapter serves both shells',
    ).toBe(true);
    expect(s.includes('probeDeps')).toBe(true);
  });
  it('does NOT re-implement the probe locally', () => {
    const s = code(SYNC);
    expect(
      s.includes('spawnSync('),
      'a second spawn here would be the duplicate the adapter extraction removed; the next pnpm change would fix one copy and silently leave this one',
    ).toBe(false);
    expect(s.includes('buildProbeEnv')).toBe(false);
  });
  it('runs the cheap tier-1 filter before the expensive probe', () => {
    const s = code(SYNC);
    const t1 = s.indexOf('classifyDepsCandidate(');
    const t2 = s.indexOf('probeDeps(');
    expect(t1, 'tier 1 must be called').toBeGreaterThan(-1);
    expect(t2, 'tier 2 must be called').toBeGreaterThan(-1);
    expect(
      t1,
      'the probe costs ~7.7s per worktree; across 45 worktrees an unfiltered probe adds ~5.8 minutes to a 30s task',
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
    const s = code(PROBE);
    expect(
      s.includes('--config.verifyDepsBeforeRun=error'),
      'the probe reuses pnpm own checkDepsStatus without changing the repo-wide setting',
    ).toBe(true);
    expect(
      s.includes('buildProbeEnv'),
      'env config OUTRANKS the --config flag, so an inherited warn value silently downgraded the probe and made every stale worktree read healthy',
    ).toBe(true);
  });
  it('NEVER installs: sync must report drift, not heal it', () => {
    const s = code(SYNC);
    expect(
      s.includes('install --force') || s.includes('--frozen-lockfile'),
      'an implicit install across 45 worktrees on a 9.7GiB box is destructive; the operator decides when to install',
    ).toBe(false);
  });
  it('NEVER installs from the adapter either: probing is not healing', () => {
    const s = code(PROBE);
    expect(
      s.includes('install --force') || s.includes('--frozen-lockfile'),
      'the probe measures; deps:reconcile heals. Merging those roles would make every sync a mutation',
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
      'stage 1 reports only; failing 45 drifted worktrees at once would block every terminal on the box',
    ).toBe(true);
  });
});
