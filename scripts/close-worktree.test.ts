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
//  - closePlan(verdict, input): pure argv list; never emits --force / -f, and a
//    branch delete NEVER appears in a plan the core did not clear.
// NOTE (2026-07-28): the base fixture sets idleHours: 999 (well past the recency
// threshold) so these pre-recency assertions exercise their intended dimension;
// the recency guard itself is covered in close-worktree-recency.test.ts.
//
// FIXTURE VIA THE FACTORY (2026-08-08). `clean` was a hand-written object
// literal restating the schema field by field. When the arc that added `retired`
// and `idleHours` landed, the literal went stale and every decideClose(clean)
// call became a TS2345 -- 15 of the 58 errors the //#typecheck:scripts ratchet
// records, all from ONE fixture. That is the documented reason the factory
// shape exists: a new field is adjusted in a single default instead of at every
// call site. makeCloseInput is an Object Mother taking Partial overrides rather
// than proliferating named variants, so it does not accrete the bloat that
// pattern is criticised for.
//
// WHY NOT `satisfies`. The 2026 advice for plain fixtures is `satisfies`, which
// validates shape without widening. It would be a DOWNGRADE here: it is
// compile-time only, whereas makeCloseInput parses through
// WorktreeCloseInputSchema and so enforces the runtime invariants these very
// tests exercise (non-negative, integer counters).
//
// The contract tests below still spread the baseline and override one field
// with a malformed value on purpose: that is what proves the boundary rejects
// it. Those assertions are unchanged.

import { describe, it, expect } from 'vitest';
import {
  WorktreeCloseInputSchema,
  decideClose,
  closePlan,
  makeCloseInput,
} from './close-worktree.js';

const clean = makeCloseInput({
  path: '/home/u/code/wt-alpha',
  branch: 'feature/order-status-groups',
  hasUpstream: true,
  aheadOfRemote: 0,
  dirtyFileCount: 0,
  containedInIntegration: true,
  isPrimaryClone: false,
  idleHours: 999,
});

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
  // UNPUSHED NOW REQUIRES REAL LOSS (2026-08-09). This case previously spread
  // `clean` -- whose containedInIntegration is TRUE -- and set aheadOfRemote
  // alone, so it asserted that a branch whose every commit is already in
  // origin/develop must still be refused. That expectation WAS the defect:
  // closing t1-wt2-cf-beacon-no-transform refused with ahead=117 contained=true
  // idleH=604, and six sibling worktrees were stuck the same way. aheadOfRemote
  // is measured against the branch's OWN upstream, which goes stale the moment a
  // PR merges and the branch is later synced down from develop.
  //
  // The INVARIANT this case exists for is unchanged and still enforced: commits
  // that exist only here must never be deleted. Only the fixture moved -- from
  // one that could not lose anything, to one that genuinely can.
  it('refuses unpushed commits that are not contained anywhere else', () => {
    expect(decideClose({ ...clean, aheadOfRemote: 19, containedInIntegration: false })).toEqual({
      action: 'refuse',
      reasons: ['unpushed', 'unmerged'],
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

describe('close-worktree: plan is pure argv and never discards a working tree', () => {
  // -d -> -D (2026-08-09). -d checks containment against HEAD OR THE BRANCH'S
  // UPSTREAM, never the integration branch, so on a branch whose remote ref is
  // stale it fails with "not fully merged" while git itself prints "even though
  // it is merged to HEAD". Live, that crashed the plan AFTER the worktree was
  // already removed -- a partially applied close, worse than refusing.
  // decideClose proves ancestry against origin/develop and issues `remove` only
  // when it holds, so the delete is cleared before it is ever planned.
  it('emits worktree remove then branch -D for a remove verdict', () => {
    expect(closePlan(decideClose(clean), clean)).toEqual([
      ['git', 'worktree', 'remove', clean.path],
      ['git', 'branch', '-D', clean.branch],
    ]);
  });
  it('emits nothing for a refuse verdict', () => {
    const dirty = { ...clean, dirtyFileCount: 1 };
    expect(closePlan(decideClose(dirty), dirty)).toEqual([]);
  });
  // The prohibition that still stands: worktree removal must never discard an
  // unclean tree. Containment vouches for COMMITTED work reachable from the
  // integration branch; it says nothing about uncommitted files, so --force and
  // -f remain banned outright. The branch-ref delete is the only widened case,
  // and the case above pins it to a verdict the core cleared.
  it('never forces the worktree removal itself', () => {
    const flat = closePlan(decideClose(clean), clean).flat();
    expect(flat.includes('--force')).toBe(false);
    expect(flat.includes('-f')).toBe(false);
  });
});
