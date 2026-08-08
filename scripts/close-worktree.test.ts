// scripts/close-worktree.test.ts
// RED-first (worktree-close arc, 2026-07-15): capture worktree closure as a
// tested root script instead of hand-rolled git idioms.
// Evidence: sync:worktrees enumerates and fast-forwards only (refuses on
// divergence, never resets) and has NO removal path; grep of package.json +
// turbo.jsonc proved no close task exists. Precedent: pure module in scripts/
// + colocated test (compose-identity.ts), run by test:scripts = vitest run scripts.
// Contract (Zod-first, Axis-1 boundary):
//  - WorktreeCloseInputSchema: path, branch, hasUpstream, aheadOfRemote,
//    dirtyFileCount, containedInIntegration, isPrimaryClone, retired, idleHours.
//  - decideClose(input): pure verdict { action, reasons }; refuses on any loss
//    risk, mirroring the sync-worktrees.ts precedent (refuse, never force).
//  - closePlan(verdict, input): pure argv list; never emits --force / -D / -f.
// NOTE (2026-07-28): the base fixture sets idleHours: 999 (well past the recency
// threshold) so these pre-recency assertions exercise their intended dimension;
// the recency guard itself is covered in close-worktree-recency.test.ts.

import { describe, it, expect } from 'vitest';
import {
  WorktreeCloseInputSchema,
  decideClose,
  closePlan,
} from './close-worktree.js';

const clean = {
  path: '/home/u/code/wt-alpha',
  branch: 'feature/order-status-groups',
  hasUpstream: true,
  aheadOfRemote: 0,
  dirtyFileCount: 0,
  containedInIntegration: true,
  isPrimaryClone: false,
  idleHours: 999,
};

describe('close-worktree: Zod contract at the trust boundary', () => {
  it('accepts a well-formed input', () => {
    expect(WorktreeCloseInputSchema.parse(clean).branch).toBe('feature/order-status-groups');
  });
  it('rejects negative counters', () => {
    expect(() => WorktreeCloseInputSchema.parse({ ...clean, aheadOfRemote: -1 })).toThrow();
    expect(() => WorktreeCloseInputSchema.parse({ ...clean, dirtyFileCount: -1 })).toThrow();
  });
  it('rejects non-integer counters', () => {
    expect(() => WorktreeCloseInputSchema.parse({ ...clean, aheadOfRemote: 1.5 })).toThrow();
  });
  it('rejects an empty branch or path', () => {
    expect(() => WorktreeCloseInputSchema.parse({ ...clean, branch: '' })).toThrow();
    expect(() => WorktreeCloseInputSchema.parse({ ...clean, path: '' })).toThrow();
  });
});

describe('close-worktree: verdict refuses on every loss risk', () => {
  it('removes a clean, pushed, fully merged worktree', () => {
    const v = decideClose(clean);
    expect(v.action).toBe('remove');
    expect(v.reasons).toEqual([]);
  });
  it('refuses the primary clone', () => {
    expect(decideClose({ ...clean, isPrimaryClone: true })).toEqual({
      action: 'refuse',
      reasons: ['primary-clone'],
    });
  });
  it('refuses the primary clone even when everything else is clean', () => {
    const v = decideClose({ ...clean, isPrimaryClone: true, dirtyFileCount: 4 });
    expect(v.reasons).toEqual(['primary-clone']);
  });
  it('refuses a dirty tree rather than discarding files', () => {
    expect(decideClose({ ...clean, dirtyFileCount: 3 })).toEqual({
      action: 'refuse',
      reasons: ['dirty'],
    });
  });
  it('refuses unpushed commits', () => {
    expect(decideClose({ ...clean, aheadOfRemote: 19 })).toEqual({
      action: 'refuse',
      reasons: ['unpushed'],
    });
  });
  it('refuses a branch with no upstream', () => {
    expect(decideClose({ ...clean, hasUpstream: false })).toEqual({
      action: 'refuse',
      reasons: ['no-upstream'],
    });
  });
  it('refuses work not contained in the integration branch', () => {
    expect(decideClose({ ...clean, containedInIntegration: false })).toEqual({
      action: 'refuse',
      reasons: ['unmerged'],
    });
  });
  it('accumulates every reason, not just the first', () => {
    const v = decideClose({
      ...clean,
      hasUpstream: false,
      aheadOfRemote: 2,
      dirtyFileCount: 1,
      containedInIntegration: false,
    });
    expect(v.action).toBe('refuse');
    expect(v.reasons).toEqual(['no-upstream', 'unpushed', 'dirty', 'unmerged']);
  });
  it('parses at the boundary: a malformed input throws, never silently removes', () => {
    expect(() => decideClose({ ...clean, aheadOfRemote: -3 })).toThrow();
  });
});

describe('close-worktree: plan is pure argv and never forces', () => {
  it('emits worktree remove then branch -d for a remove verdict', () => {
    expect(closePlan(decideClose(clean), clean)).toEqual([
      ['git', 'worktree', 'remove', clean.path],
      ['git', 'branch', '-d', clean.branch],
    ]);
  });
  it('emits nothing for a refuse verdict', () => {
    const dirty = { ...clean, dirtyFileCount: 1 };
    expect(closePlan(decideClose(dirty), dirty)).toEqual([]);
  });
  it('never emits a destructive flag', () => {
    const flat = closePlan(decideClose(clean), clean).flat();
    expect(flat.includes('--force')).toBe(false);
    expect(flat.includes('-D')).toBe(false);
    expect(flat.includes('-f')).toBe(false);
  });
});
