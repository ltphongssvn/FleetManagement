// scripts/close-worktree-retired.test.ts
// RED (F4, worktree-close retired arc): decideClose cannot express a branch
// that is deliberately RETIRED -- pushed, clean, upstream-tracked, but never
// merged and never intended to merge. Today containedInIntegration=false is a
// flat unmerged refusal, so such a worktree can never be closed and parks on
// disk forever (observed: t4-wt6-co-so-du-lieu after its retirement record).
//
// Contract pinned here:
//  * retired defaults false -- opt-in only, never inferred from state;
//  * retired waives ONLY the unmerged reason; primary-clone / no-upstream /
//    unpushed / dirty still refuse, because those are loss risks and retiring
//    a branch does not make losing work acceptable;
//  * a retired close yields action remove-keep-branch, a distinct verdict so
//    callers cannot confuse it with a normal merged removal;
//  * closePlan for remove-keep-branch emits ONLY git worktree remove -- never
//    git branch -d. The branch is preserved deliberately (it survives on
//    origin as history); deleting the local ref is exactly what must not
//    happen. This is stronger than relying on -d refusing on containment.
import { describe, it, expect } from 'vitest';
import {
  decideClose,
  closePlan,
  WorktreeCloseInputSchema,
  type WorktreeCloseInput,
} from './close-worktree.js';
const RETIRED_BASE: WorktreeCloseInput = {
  path: '/home/x/t4-wt6-co-so-du-lieu',
  branch: 'feature/co-so-du-lieu',
  hasUpstream: true,
  aheadOfRemote: 0,
  dirtyFileCount: 0,
  containedInIntegration: false,
  isPrimaryClone: false,
  retired: true,
};
describe('decideClose: retired branches', () => {
  it('defaults retired to false so existing callers are unchanged', () => {
    const parsed = WorktreeCloseInputSchema.parse({
      path: '/p',
      branch: 'b',
      hasUpstream: true,
      aheadOfRemote: 0,
      dirtyFileCount: 0,
      containedInIntegration: false,
      isPrimaryClone: false,
    });
    expect(parsed.retired).toBe(false);
  });
  it('still refuses unmerged when NOT retired (unchanged behaviour)', () => {
    const v = decideClose({ ...RETIRED_BASE, retired: false });
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('unmerged');
  });
  it('permits closing a retired branch that is pushed and clean', () => {
    const v = decideClose(RETIRED_BASE);
    expect(v.action).toBe('remove-keep-branch');
    expect(v.reasons).toEqual([]);
  });
  it('retired does NOT waive unpushed', () => {
    const v = decideClose({ ...RETIRED_BASE, aheadOfRemote: 3 });
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('unpushed');
    expect(v.reasons).not.toContain('unmerged');
  });
  it('retired does NOT waive dirty', () => {
    const v = decideClose({ ...RETIRED_BASE, dirtyFileCount: 2 });
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('dirty');
  });
  it('retired does NOT waive no-upstream', () => {
    const v = decideClose({ ...RETIRED_BASE, hasUpstream: false });
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('no-upstream');
  });
  it('retired does NOT waive primary-clone', () => {
    const v = decideClose({ ...RETIRED_BASE, isPrimaryClone: true });
    expect(v.action).toBe('refuse');
    expect(v.reasons).toEqual(['primary-clone']);
  });
  it('a retired branch that IS merged still yields remove-keep-branch', () => {
    const v = decideClose({ ...RETIRED_BASE, containedInIntegration: true });
    expect(v.action).toBe('remove-keep-branch');
  });
});
describe('closePlan: retired branches keep their ref', () => {
  it('emits ONLY worktree remove -- never branch -d', () => {
    const v = decideClose(RETIRED_BASE);
    const plan = closePlan(v, RETIRED_BASE);
    expect(plan).toEqual([['git', 'worktree', 'remove', RETIRED_BASE.path]]);
    expect(plan.flat()).not.toContain('branch');
  });
  it('never emits a force or delete flag for a retired close', () => {
    const plan = closePlan(decideClose(RETIRED_BASE), RETIRED_BASE).flat();
    for (const banned of ['-D', '--force', '-f', '-d']) {
      expect(plan).not.toContain(banned);
    }
  });
  it('a normal merged close still deletes the branch (unchanged)', () => {
    const input: WorktreeCloseInput = { ...RETIRED_BASE, retired: false, containedInIntegration: true };
    const plan = closePlan(decideClose(input), input);
    expect(plan).toEqual([
      ['git', 'worktree', 'remove', input.path],
      ['git', 'branch', '-d', input.branch],
    ]);
  });
  it('a refusal still emits no commands', () => {
    const input: WorktreeCloseInput = { ...RETIRED_BASE, dirtyFileCount: 1 };
    expect(closePlan(decideClose(input), input)).toEqual([]);
  });
});
