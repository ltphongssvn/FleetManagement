// scripts/e2e/release-promote.test.ts
// Outside-in RED: contract for the WHOLE GitFlow promote cycle (develop -> main)
// BEFORE it exists. Graduates the hand-chained orchestration (create release PR ->
// watch CI -> admin-merge --merge -> wait Release run -> authoritative closeout +
// back-merge) into one schema-first script that COMPOSES the already-proven pure
// release-closeout functions. Encodes the merge-flag rules I kept getting wrong by
// hand: develop->main is a MERGE commit, never squash, and never --delete-branch
// (develop is permanent). Imports a module that does not exist yet -> MUST fail.
import { describe, it, expect } from 'vitest';
import {
  promoteConfigSchema,
  promotePhases,
  releaseMergeArgs,
  selectReleaseRunForSha,
} from './release-promote.ts';

const base = { baseBranch: 'main', developBranch: 'develop' };

describe('promoteConfigSchema', () => {
  it('accepts a valid config and defaults branches', () => {
    const c = promoteConfigSchema.parse({});
    expect(c.baseBranch).toBe('main');
    expect(c.developBranch).toBe('develop');
  });
  it('rejects an empty base branch', () => {
    expect(promoteConfigSchema.safeParse({ baseBranch: '' }).success).toBe(false);
  });
});

describe('promotePhases', () => {
  it('orders the cycle: create PR -> watch CI -> merge -> wait release -> closeout', () => {
    const p = promotePhases(promoteConfigSchema.parse(base));
    expect(p).toEqual(['create_pr', 'watch_ci', 'admin_merge', 'wait_release', 'closeout']);
  });
});

describe('releaseMergeArgs', () => {
  it('promotes develop->main as a MERGE commit with --admin and NO --delete-branch', () => {
    const args = releaseMergeArgs(42);
    expect(args).toContain('42');
    expect(args).toContain('--merge');
    expect(args).toContain('--admin');
    expect(args).not.toContain('--squash');
    expect(args).not.toContain('--delete-branch');
  });
});

describe('selectReleaseRunForSha', () => {
  // The wait_release race that mis-tagged #94: promote watched the most-recent run
  // (--limit 1) instead of the run for THIS merge commit, so closeout ran before
  // that run created the tag. Fix correlates by head SHA (2026 wait-for-workflow
  // norm). Pure selector over a run list; main() polls with it until done+success.
  const sha = 'ef20534aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const prev = 'b7b691cbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const mk = (headSha: string, status: string, conclusion: string):
    { databaseId: number; headSha: string; status: string; conclusion: string } =>
    ({ databaseId: 1, headSha, status, conclusion });

  it('returns null when no run matches the merge SHA yet (run not created -> keep polling)', () => {
    const runs = [mk(prev, 'completed', 'success')];
    expect(selectReleaseRunForSha(runs, sha)).toBeNull();
  });
  it('matches the run whose headSha equals the merge commit (full SHA)', () => {
    const runs = [mk(prev, 'completed', 'success'), { databaseId: 42, headSha: sha, status: 'in_progress', conclusion: '' }];
    expect(selectReleaseRunForSha(runs, sha)?.databaseId).toBe(42);
  });
  it('matches on a short SHA prefix (git rev-parse --short vs full API headSha)', () => {
    const runs = [{ databaseId: 7, headSha: sha, status: 'completed', conclusion: 'success' }];
    expect(selectReleaseRunForSha(runs, 'ef20534')?.databaseId).toBe(7);
  });
  it('does NOT match the previous run for a different commit (the exact #94 bug)', () => {
    const runs = [mk(prev, 'completed', 'success')];
    expect(selectReleaseRunForSha(runs, 'ef20534')).toBeNull();
  });
  it('returns the matching run regardless of status so the caller can poll to completion', () => {
    const runs = [{ databaseId: 9, headSha: sha, status: 'queued', conclusion: '' }];
    const r = selectReleaseRunForSha(runs, sha);
    expect(r?.databaseId).toBe(9);
    expect(r?.status).toBe('queued');
  });
});
