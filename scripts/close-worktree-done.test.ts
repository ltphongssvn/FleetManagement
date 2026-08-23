// scripts/close-worktree-done.test.ts
// RED-first: --done waives ONLY the recency guard, and ONLY for work that is
// already contained in the integration branch.
//
// WHY THIS EXISTS. The recency guard refuses a worktree whose per-worktree HEAD
// reflog shows activity within 24h, because a merged-and-clean worktree can
// still be the LIVE directory a terminal is coding in (near-miss:
// t20-wt1-twelve-factor-audit). That is a real hazard and the guard stays.
//
// But it makes a FINISHED session uncloseable. Observed on
// t106-wt1-driver-delete-audit: contained=true, dirty=0, upstream=true,
// ahead=3 (all in origin/develop), every PR merged, production verified -- and
// refused solely on idleH=0, purely because the operator was still at the
// keyboard. Waiting out 24 hours to reclaim a finished worktree is a treadmill,
// and re-running later is exactly the kind of uncaptured follow-up that gets
// forgotten across sessions.
//
// The 2026 industry criteria for safe worktree removal are merged + clean +
// not-primary; recency appears in none of them. It is a PROXY for "work may be
// in flight", while containment is DIRECT EVIDENCE the work is finished. A
// proxy must not override direct evidence -- but neither can it simply be
// deleted, because the proxy is what caught the t20 near-miss, where the work
// was ALSO contained. The resolution is the shape the codebase already uses for
// exactly this ambiguity: an explicit operator opt-in, mirroring --retired.
// Invoking the flag IS the operator deciding (the deps:reconcile doctrine).
//
// SCOPE IS DELIBERATELY NARROW. --done waives recent and NOTHING else, and is
// itself inert unless containedInIntegration is true. dirty, unpushed,
// no-upstream and primary-clone all still refuse, because declaring a session
// finished does not make losing work acceptable. That is what keeps this an
// evidence-gated waiver rather than a --force in disguise.
import { describe, it, expect } from 'vitest';
import { decideClose, closePlan, makeCloseInput } from './close-worktree.js';

describe('decideClose - --done waives recency for contained work', () => {
  it('still REFUSES a recent worktree without the flag (guard intact)', () => {
    const v = decideClose(makeCloseInput({ idleHours: 0 }));
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('recent');
  });

  it('PERMITS a recent worktree when done and contained', () => {
    const v = decideClose(makeCloseInput({ idleHours: 0, done: true }));
    expect(v.action).toBe('remove');
    expect(v.reasons).toEqual([]);
  });

  it('reproduces the exact t106 state: ahead=3, contained, clean, idleH=0', () => {
    const v = decideClose(
      makeCloseInput({
        aheadOfRemote: 3,
        containedInIntegration: true,
        dirtyFileCount: 0,
        hasUpstream: true,
        idleHours: 0,
        done: true,
      }),
    );
    expect(v.action).toBe('remove');
  });

  it('does NOT waive recency when the work is NOT contained', () => {
    // Without containment there is no direct evidence the work is finished, so
    // the proxy is all we have and it must hold.
    const v = decideClose(
      makeCloseInput({
        idleHours: 0,
        containedInIntegration: false,
        done: true,
      }),
    );
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('recent');
    expect(v.reasons).toContain('unmerged');
  });

  it('does NOT waive dirty', () => {
    const v = decideClose(makeCloseInput({ idleHours: 0, dirtyFileCount: 2, done: true }));
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('dirty');
  });

  it('does NOT waive unpushed', () => {
    const v = decideClose(
      makeCloseInput({
        idleHours: 0,
        aheadOfRemote: 5,
        containedInIntegration: false,
        done: true,
      }),
    );
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('unpushed');
  });

  it('does NOT waive no-upstream', () => {
    const v = decideClose(makeCloseInput({ idleHours: 0, hasUpstream: false, done: true }));
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('no-upstream');
  });

  it('does NOT waive primary-clone', () => {
    const v = decideClose(makeCloseInput({ idleHours: 0, isPrimaryClone: true, done: true }));
    expect(v.action).toBe('refuse');
    expect(v.reasons).toEqual(['primary-clone']);
  });

  it('composes with retired: a retired branch is never contained, so recency holds', () => {
    const v = decideClose(
      makeCloseInput({
        idleHours: 0,
        containedInIntegration: false,
        retired: true,
        done: true,
      }),
    );
    expect(v.action).toBe('refuse');
    expect(v.reasons).toContain('recent');
  });

  it('defaults to false so every existing caller is unchanged', () => {
    expect(makeCloseInput().done).toBe(false);
  });

  it('emits the full remove plan, branch delete included', () => {
    const input = makeCloseInput({ idleHours: 0, done: true });
    const plan = closePlan(decideClose(input), input);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual(['git', 'worktree', 'remove', input.path]);
    expect(plan[1]).toEqual(['git', 'branch', '-D', input.branch]);
  });
});
