// scripts/close-worktree-contained.test.ts
// RED->GREEN: `unpushed` must mean WORK COULD BE LOST, not merely "ahead of the
// branch's own remote ref" -- and the PLAN must not re-ask that question with a
// tool that answers it against the wrong reference.
//
// THE DEFECT, observed live on 2026-08-09 closing t1-wt2-cf-beacon-no-transform:
//   verdict:  refuse
//   refused because: - unpushed
//   state: ahead=117 dirty=0 upstream=true contained=true retired=false idleH=604
// All 117 commits were already in origin/develop. Nothing could be lost, the
// worktree was 25 days idle, yet the close refused, so the directory parked on
// disk forever. Six sibling worktrees sat in the same state.
//
// THE SAME ROOT CLASS, THREE TIMES OVER. aheadOfRemote is measured against the
// BRANCH'S OWN upstream, which goes stale the moment a PR merges and the branch
// is later synced down from develop:
//   sync:worktrees  -- reported "ahead 117; nothing to pull" on a merged branch
//   worktree:close  -- refused "unpushed" while contained=true
//   git branch -d   -- refuses unless merged to HEAD *or its upstream*, so it
//                      refused this very branch "even though it is merged to
//                      HEAD" (proven live: the plan's second step crashed and
//                      left the worktree removed but the branch ref alive)
// All three ask how a branch compares to its OWN ref. The question that matters
// is whether the work is in the INTEGRATION branch.
//
// WHY THE PLAN MAY NOW USE -D. decideClose has already proved ancestry against
// origin/develop -- a strictly stronger and correctly-referenced check than -d
// performs. The `remove` verdict is issued ONLY when containedInIntegration is
// true; a retired (uncontained-but-intentional) close yields remove-keep-branch,
// whose plan emits no delete at all. So -D under a remove verdict cannot lose
// work, while -d cannot succeed at all. The replacement invariant, asserted
// below, is that a delete NEVER appears in a plan the core did not clear.
//
// WHY NOT --retired for the original refusal. retired means ABANDONED WHILE
// UNMERGED; these branches are MERGED. It would file a false record in the one
// field distinguishing the two cases and leave the defect to re-fire forever.

import { describe, it, expect } from 'vitest';
import { decideClose, closePlan, makeCloseInput } from './close-worktree.ts';

describe('unpushed is a loss signal, not a distance measurement', () => {
  it('permits closing a branch that is ahead of its own remote but CONTAINED', () => {
    const v = decideClose(makeCloseInput({ aheadOfRemote: 117, containedInIntegration: true }));
    expect(
      v.action,
      'this is the live t1-wt2 case: 117 commits ahead of a stale branch ref, ' +
        'every one of them already in origin/develop, so nothing can be lost',
    ).toBe('remove');
  });

  it('still REFUSES when ahead and NOT contained -- the real loss case', () => {
    const v = decideClose(makeCloseInput({ aheadOfRemote: 3, containedInIntegration: false }));
    expect(
      v.action,
      'ahead>0 with no containment is exactly the commit-only-exists-here case ' +
        'the guard was built for; widening must not weaken it',
    ).toBe('refuse');
    if (v.action !== 'refuse') expect.unreachable('narrowing');
    expect(v.reasons).toContain('unpushed');
  });

  it('reports unmerged AND unpushed together when neither holds', () => {
    const v = decideClose(makeCloseInput({ aheadOfRemote: 3, containedInIntegration: false }));
    if (v.action !== 'refuse') expect.unreachable('narrowing');
    expect(
      v.reasons,
      'reporting every reason at once is the existing contract; the widening ' +
        'must not collapse two independent findings into one',
    ).toEqual(expect.arrayContaining(['unpushed', 'unmerged']));
  });

  it('does not let RETIRED waive unpushed when the work is uncontained', () => {
    const v = decideClose(makeCloseInput({
      aheadOfRemote: 3,
      containedInIntegration: false,
      retired: true,
    }));
    expect(
      v.action,
      'retired waives ONLY unmerged; a retired branch with local-only commits ' +
        'still has work to lose',
    ).toBe('refuse');
    if (v.action !== 'refuse') expect.unreachable('narrowing');
    expect(v.reasons).toContain('unpushed');
    expect(v.reasons).not.toContain('unmerged');
  });

  it('keeps refusing a RECENT contained worktree -- liveness is independent', () => {
    const v = decideClose(makeCloseInput({
      aheadOfRemote: 117,
      containedInIntegration: true,
      idleHours: 1,
    }));
    expect(
      v.action,
      'containment says nothing about whether a terminal is coding in this ' +
        'directory right now; the recency interlock must survive the widening',
    ).toBe('refuse');
    if (v.action !== 'refuse') expect.unreachable('narrowing');
    expect(v.reasons).toContain('recent');
    expect(v.reasons).not.toContain('unpushed');
  });

  it('still refuses a DIRTY contained worktree', () => {
    const v = decideClose(makeCloseInput({
      aheadOfRemote: 117,
      containedInIntegration: true,
      dirtyFileCount: 2,
    }));
    if (v.action !== 'refuse') expect.unreachable('narrowing');
    expect(
      v.reasons,
      'uncommitted changes are unreachable from the integration branch by ' +
        'definition, so containment cannot vouch for them',
    ).toContain('dirty');
  });

  it('still refuses when there is NO upstream, contained or not', () => {
    const v = decideClose(makeCloseInput({
      aheadOfRemote: 0,
      containedInIntegration: true,
      hasUpstream: false,
    }));
    if (v.action !== 'refuse') expect.unreachable('narrowing');
    expect(v.reasons).toContain('no-upstream');
  });
});

describe('the plan deletes with -D, because the core already proved containment', () => {
  it('emits branch -D for a remove verdict on a stale-remote branch', () => {
    const input = makeCloseInput({ aheadOfRemote: 117, containedInIntegration: true });
    const plan = closePlan(decideClose(input), input);
    expect(
      plan,
      'git branch -d refuses unless merged to HEAD OR ITS UPSTREAM, so on this ' +
        'exact branch it failed live with "not fully merged" while git itself ' +
        'reported "even though it is merged to HEAD" -- the plan crashed after ' +
        'the worktree was already removed, leaving a partially applied close',
    ).toEqual([
      ['git', 'worktree', 'remove', input.path],
      ['git', 'branch', '-D', input.branch],
    ]);
  });

  it('NEVER emits a delete for a retired close: the branch is kept on purpose', () => {
    const input = makeCloseInput({ containedInIntegration: false, retired: true });
    const plan = closePlan(decideClose(input), input);
    expect(
      plan.flat(),
      'remove-keep-branch is the whole point of retired; -D must not leak into it',
    ).not.toContain('-D');
    expect(plan).toEqual([['git', 'worktree', 'remove', input.path]]);
  });

  it('emits NOTHING at all for a refuse verdict', () => {
    const input = makeCloseInput({ dirtyFileCount: 1 });
    expect(closePlan(decideClose(input), input)).toEqual([]);
  });

  it('never emits worktree --force: removal itself stays non-destructive', () => {
    const input = makeCloseInput({ aheadOfRemote: 117, containedInIntegration: true });
    const flat = closePlan(decideClose(input), input).flat();
    expect(
      flat,
      'the -D widening is scoped to the BRANCH REF, whose containment the core ' +
        'verified; discarding an unclean working tree was never cleared by it',
    ).not.toContain('--force');
    expect(flat).not.toContain('-f');
  });
});
