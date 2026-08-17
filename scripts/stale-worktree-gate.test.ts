// scripts/stale-worktree-gate.test.ts
// RED->GREEN for the stale-worktree gate: a worktree that is FINISHED and
// IDLE is debt, and must fail a gate rather than park on disk forever.
//
// THE INCIDENT. Closing t1-wt2-cf-beacon-no-transform reported:
//   state: ahead=117 dirty=0 upstream=true contained=true retired=false idleH=604
// Every commit was already in origin/develop and the directory had been
// untouched for 25 DAYS. Six siblings sat in the same state. The predicate bug
// that refused them is fixed (#550); nothing yet makes anyone actually reclaim
// them, so they accumulate silently until a census happens to be read.
//
// THE THRESHOLD IS NOT A NEW NUMBER. close-worktree.ts already defines
// RECENT_IDLE_THRESHOLD_HOURS = 24 as the line between LIVE (protected from
// closing) and STALE (removable). Today only half that invariant is enforced:
// worktree:close refuses to delete a live worktree, but nothing insists a stale
// one gets closed. This gate is the missing half, and it reuses the same
// constant so a future tuning moves both sides together rather than letting two
// numbers drift into disagreement.
//
// WHY "STALE" ALONE IS THE WRONG PREDICATE. Measured on this estate: 38 of 48
// worktrees exceed 24h idle. A gate failing on all of them would be born red,
// make every branch unmergeable at once, and teach everyone to ignore it --
// the exact failure mode documented when //#typecheck:scripts was deliberately
// kept ungated until it reached zero. Long-lived idle work in progress is
// legitimate; what is NOT legitimate is finished work nobody reclaimed.
//
// SO THE INVARIANT IS: stale AND closeable. Closeable means decideClose would
// return `remove` -- contained, clean, pushed, non-primary. That set is exactly
// the debt: the work has landed, nothing can be lost, and the directory is
// pure residue. It is also naturally near-zero, so the gate is born green and
// stays meaningful.

import { describe, it, expect } from 'vitest';
import { RECENT_IDLE_THRESHOLD_HOURS } from './close-worktree.ts';
import { classifyStaleWorktrees, describeStaleWorktrees } from './stale-worktree-gate.ts';

const reclaimable = {
  path: '/home/u/code/t1-wt2-cf-beacon',
  branch: 'fix/cf-beacon',
  idleHours: 604,
  closeable: true,
};

describe('classifyStaleWorktrees: finished AND idle is debt', () => {
  it('reports clean when nothing is reclaimable', () => {
    const v = classifyStaleWorktrees({ worktrees: [], maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS });
    expect(v.kind).toBe('clean');
  });

  it('flags a worktree that is closeable and long idle', () => {
    const v = classifyStaleWorktrees({
      worktrees: [reclaimable],
      maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
    });
    expect(
      v.kind,
      'this is the live t1-wt2 case: 117 commits already in develop, clean, ' +
        'and untouched for 25 days -- pure residue',
    ).toBe('reclaimable');
    if (v.kind !== 'reclaimable') expect.unreachable('narrowing');
    expect(v.worktrees).toHaveLength(1);
    expect(v.worktrees[0]?.path).toContain('cf-beacon');
  });

  it('IGNORES a long-idle worktree that is NOT closeable', () => {
    const v = classifyStaleWorktrees({
      worktrees: [{ ...reclaimable, closeable: false }],
      maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
    });
    expect(
      v.kind,
      'unmerged work parked for months is legitimate long-lived WIP; failing ' +
        'on it would make 38 of 48 worktrees fail at once and train everyone ' +
        'to ignore the gate',
    ).toBe('clean');
  });

  it('IGNORES a closeable worktree that is still ACTIVE', () => {
    const v = classifyStaleWorktrees({
      worktrees: [{ ...reclaimable, idleHours: 1 }],
      maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
    });
    expect(
      v.kind,
      'a terminal may be mid-slice between a merge and the next push; that is ' +
        'exactly the near-miss the recency guard was added for',
    ).toBe('clean');
  });

  it('treats exactly the threshold as ACTIVE, matching decideClose', () => {
    const v = classifyStaleWorktrees({
      worktrees: [{ ...reclaimable, idleHours: RECENT_IDLE_THRESHOLD_HOURS }],
      maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
    });
    expect(
      v.kind,
      'decideClose uses strict < for recent, so at the threshold a worktree is ' +
        'removable; the two must agree or a worktree could be gate-flagged and ' +
        'close-refused simultaneously -- an unresolvable state',
    ).toBe('clean');
  });

  it('flags one millisecond past the threshold', () => {
    const v = classifyStaleWorktrees({
      worktrees: [{ ...reclaimable, idleHours: RECENT_IDLE_THRESHOLD_HOURS + 0.001 }],
      maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
    });
    expect(v.kind).toBe('reclaimable');
  });

  it('reports every reclaimable worktree, not just the first', () => {
    const v = classifyStaleWorktrees({
      worktrees: [
        reclaimable,
        { ...reclaimable, path: '/home/u/code/t7-wt1-device-binding' },
        { ...reclaimable, path: '/home/u/code/t43-wt1-host-lock', closeable: false },
      ],
      maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
    });
    if (v.kind !== 'reclaimable') expect.unreachable('narrowing');
    expect(
      v.worktrees,
      'stopping at the first hides the size of the backlog, and a gate that ' +
        'understates the work is one people defer',
    ).toHaveLength(2);
  });

  it('rejects a non-positive threshold rather than flagging everything', () => {
    const v = classifyStaleWorktrees({ worktrees: [reclaimable], maxIdleHours: 0 });
    expect(
      v.kind,
      'a zero window would mark every worktree reclaimable including the one ' +
        'being worked in right now; misconfiguration must fail closed',
    ).toBe('invalid-policy');
  });

  it('rejects a non-finite idle reading rather than guessing', () => {
    const v = classifyStaleWorktrees({
      worktrees: [{ ...reclaimable, idleHours: Number.NaN }],
      maxIdleHours: RECENT_IDLE_THRESHOLD_HOURS,
    });
    expect(
      v.kind,
      'an unreadable reflog is not evidence of staleness; close-worktree fails ' +
        'safe by defaulting idleHours to 0 (protected), and so must this',
    ).toBe('clean');
  });
});

describe('describeStaleWorktrees: the message must name the remedy', () => {
  it('names each path and its idle time', () => {
    const msg = describeStaleWorktrees([reclaimable]);
    expect(msg).toContain('cf-beacon');
    expect(msg).toContain('604');
  });

  // DETACHED worktrees have no branch: `git worktree list --porcelain` omits
  // the branch line, and sync:worktrees reports a `detached` count, so this is
  // a real state here. Typecheck caught the original interface asserting a
  // string that may not exist; the message must degrade rather than print
  // "(null)" at an operator.
  it('renders a detached worktree without printing null', () => {
    const msg = describeStaleWorktrees([{ ...reclaimable, branch: null }]);
    expect(msg).toContain('detached');
    expect(msg).not.toContain('null');
  });

  it('names the registered close task so the fix is one command away', () => {
    const msg = describeStaleWorktrees([reclaimable]);
    expect(
      msg,
      'a gate that reports a problem without the remedy costs the reader a ' +
        'search; worktree:close is the only sanctioned removal path',
    ).toContain('worktree:close');
  });
});
