// scripts/worktree-preserve.test.ts
// GREEN (t85 worktree-preserve arc, 2026-08-05): pure decision cores for
// //#worktree:preserve -- convert uncommitted worktree state into a durable
// WIP commit before that state can be lost.
//
// WHY THIS EXISTS. A census found FOUR worktrees pinned to the yanked pnpm
// 11.13.0, frozen since 2026-07-11. Three held UNCOMMITTED work:
//   t1-wt1  15 STAGED files incl. a new capture-sequence-guard.ts + its test
//   t1-wt4   3 files incl. a new sync-develop-guard.ts + its test
//   t5-wt2   4 files incl. a new app.config.ts + its test
// None had ever had a PR. worktree:close correctly REFUSED all three on
// dirty -- but a refusal is not a resolution, and the work stayed one
// mistaken --force away from deletion for twenty-five days.
//
// WHY NOT git stash. Stash was tried first and was wrong twice over. It is
// LOCAL: stashes are never transferred to the remote, so a stashed rescue dies
// with the machine, and 2026 guidance puts its threshold in hours, not weeks.
// Worse, the failure was SILENT: git stash create captured only tracked
// changes, encoding untracked files onto a third parent that git show --stat
// does not traverse, so the snapshot reported success while omitting the new
// source files that were the entire substance of two slices.
//
// THE COUNT GATE IS THEREFORE LOAD-BEARING, not a nicety: preserved file count
// MUST equal observed dirty count, or the operation fails closed.
//
// FAILED IS A SEPARATE OUTCOME FROM SHORTFALL, and the distinction is the
// operator's next action. A shortfall means files may be GONE. A failure means
// a git command errored and the work is still sitting uncommitted -- unresolved
// but intact. Collapsing them would either understate a loss or overstate one.
import { describe, it, expect } from 'vitest';
import {
  classifyPreservation,
  commitMessageFor,
  parseDirtyEntries,
  PRESERVE_EXIT,
  preserveExitCode,
  resolvePreserveExecute,
  verifyPreservation,
} from './worktree-preserve.js';
const NL = String.fromCharCode(10);
describe('parseDirtyEntries (porcelain v1, untracked included)', () => {
  it('returns nothing for a clean tree', () => {
    expect(parseDirtyEntries('')).toEqual([]);
  });
  it('reads a staged modification', () => {
    expect(parseDirtyEntries('M  apps/api/src/a.ts')).toEqual([
      { path: 'apps/api/src/a.ts', staged: true, untracked: false },
    ]);
  });
  it('reads an unstaged modification', () => {
    expect(parseDirtyEntries(' M apps/api/src/a.ts')).toEqual([
      { path: 'apps/api/src/a.ts', staged: false, untracked: false },
    ]);
  });
  it('reads a staged addition as staged, not untracked', () => {
    expect(parseDirtyEntries('A  scripts/new.ts')).toEqual([
      { path: 'scripts/new.ts', staged: true, untracked: false },
    ]);
  });
  it('reads an untracked file', () => {
    expect(parseDirtyEntries('?? scripts/new.ts')).toEqual([
      { path: 'scripts/new.ts', staged: false, untracked: true },
    ]);
  });
  it('parses a REAL mixed census line-for-line', () => {
    const out = [
      ' M .pre-commit-config.yaml',
      '?? scripts/sync-develop-guard.test.ts',
      '?? scripts/sync-develop-guard.ts',
    ].join(NL);
    const parsed = parseDirtyEntries(out);
    expect(parsed.length).toBe(3);
    expect(parsed.filter((e) => e.untracked).length).toBe(2);
  });
  it('ignores blank trailing lines rather than counting them as files', () => {
    expect(parseDirtyEntries(' M a.ts' + NL + NL).length).toBe(1);
  });
  it('preserves paths containing parentheses', () => {
    const parsed = parseDirtyEntries('?? apps/driver-app/app/(app)/assignments.tsx');
    expect(parsed.map((e) => e.path)).toEqual(['apps/driver-app/app/(app)/assignments.tsx']);
  });
});
describe('classifyPreservation (what may be preserved)', () => {
  it('skips a clean worktree', () => {
    expect(classifyPreservation({ path: '/wt/a', branch: 'feature/x', entries: [] })).toEqual({
      action: 'skip',
      reason: 'clean',
    });
  });
  it('IDEMPOTENCY: an already-preserved worktree is clean, so a re-run skips it', () => {
    expect(
      classifyPreservation({ path: '/wt/a', branch: 'feature/x', entries: [] }).action,
      'a sweep that aborted partway must be safe to re-run; preserved worktrees are clean and must not be re-committed',
    ).toBe('skip');
  });
  it('REFUSES a detached worktree: there is no branch to commit onto', () => {
    const plan = classifyPreservation({
      path: '/wt/a',
      branch: null,
      entries: [{ path: 'a.ts', staged: false, untracked: true }],
    });
    expect(
      plan.action,
      'committing onto a detached HEAD would strand the commit where no ref reaches it',
    ).toBe('refuse');
  });
  it('plans preservation for a dirty worktree on a branch', () => {
    const plan = classifyPreservation({
      path: '/wt/a',
      branch: 'feature/x',
      entries: [{ path: 'a.ts', staged: false, untracked: true }],
    });
    expect(plan.action).toBe('preserve');
    expect(plan.action === 'preserve' && plan.fileCount).toBe(1);
  });
  it('counts staged and untracked entries alike: both are losable', () => {
    const plan = classifyPreservation({
      path: '/wt/a',
      branch: 'feature/x',
      entries: [
        { path: 'a.ts', staged: true, untracked: false },
        { path: 'b.ts', staged: false, untracked: true },
        { path: 'c.ts', staged: false, untracked: false },
      ],
    });
    expect(plan.action === 'preserve' && plan.fileCount).toBe(3);
  });
});
describe('verifyPreservation (fails closed on any shortfall)', () => {
  it('passes when every dirty file was committed', () => {
    expect(verifyPreservation({ expected: 4, committed: 4 })).toEqual({ kind: 'verified' });
  });
  it('FAILS when files were silently dropped', () => {
    const r = verifyPreservation({ expected: 4, committed: 2 });
    expect(
      r.kind,
      'git stash create reported success while omitting untracked files; equality is the only safe gate',
    ).toBe('shortfall');
    expect(r.kind === 'shortfall' && r.missing).toBe(2);
  });
  it('FAILS on a surplus too: an unexpected extra file means the scope was wrong', () => {
    expect(verifyPreservation({ expected: 2, committed: 3 }).kind).not.toBe('verified');
  });
  it('treats zero-expected-zero-committed as verified', () => {
    expect(verifyPreservation({ expected: 0, committed: 0 })).toEqual({ kind: 'verified' });
  });
});
describe('commitMessageFor (the record must explain itself)', () => {
  it('marks the commit as WIP so it is never mistaken for integration', () => {
    expect(commitMessageFor({ branch: 'feature/x', fileCount: 3 }).startsWith('wip:')).toBe(true);
  });
  it('names the branch and the file count', () => {
    const msg = commitMessageFor({ branch: 'feature/x', fileCount: 3 });
    expect(msg).toContain('feature/x');
    expect(msg).toContain('3');
  });
  it('states plainly that it is NOT an integration candidate', () => {
    expect(commitMessageFor({ branch: 'feature/x', fileCount: 1 }).toLowerCase()).toContain(
      'not an integration candidate',
    );
  });
});
describe('resolvePreserveExecute (dry-run is the default)', () => {
  it('surveys when no flag is given', () => {
    expect(resolvePreserveExecute({ execute: false })).toBe(false);
  });
  it('writes ONLY on explicit execute', () => {
    expect(resolvePreserveExecute({ execute: true })).toBe(true);
  });
});
// OPERATIONAL vs PROGRAMMER errors, per the 2026 Node practice: an operational
// failure -- a git command that errored -- is handled at runtime and must not
// crash the sweep. It gets its own count and its own exit code, because the
// operator's next action differs from every other outcome.
describe('preserveExitCode (gates, does not merely print)', () => {
  it('is 0 when nothing needed preserving', () => {
    expect(
      preserveExitCode({ preserved: 0, refused: 0, failed: 0, shortfall: 0, skipped: 5 }),
    ).toBe(PRESERVE_EXIT.ok);
  });
  it('is 0 when every dirty worktree was preserved and verified', () => {
    expect(
      preserveExitCode({ preserved: 3, refused: 0, failed: 0, shortfall: 0, skipped: 41 }),
    ).toBe(PRESERVE_EXIT.ok);
  });
  it('reports a refusal with its own code', () => {
    expect(
      preserveExitCode({ preserved: 0, refused: 1, failed: 0, shortfall: 0, skipped: 43 }),
    ).toBe(PRESERVE_EXIT.refused);
  });
  it('reports an operational failure with its own code', () => {
    expect(
      preserveExitCode({ preserved: 0, refused: 0, failed: 1, shortfall: 0, skipped: 43 }),
    ).toBe(PRESERVE_EXIT.failed);
  });
  it('lets FAILED outrank refused: an errored git command is unresolved, a refusal is a safe stop', () => {
    expect(
      preserveExitCode({ preserved: 0, refused: 2, failed: 1, shortfall: 0, skipped: 41 }),
    ).toBe(PRESERVE_EXIT.failed);
  });
  it('lets SHORTFALL dominate everything: only it means work may already be GONE', () => {
    expect(
      preserveExitCode({ preserved: 3, refused: 2, failed: 2, shortfall: 1, skipped: 36 }),
      'a shortfall may mean files were lost; a failure leaves them uncommitted but intact',
    ).toBe(PRESERVE_EXIT.shortfall);
  });
  it('keeps every code distinct so the operator can branch on it', () => {
    const codes = Object.values(PRESERVE_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it('reserves 2 for usage, per the universal CLI convention', () => {
    expect(PRESERVE_EXIT.usage).toBe(2);
  });
});
