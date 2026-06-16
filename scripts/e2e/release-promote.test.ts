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
