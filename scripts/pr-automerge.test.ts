// scripts/pr-automerge.test.ts
// RED->GREEN spec for the pure cores of //#pr:automerge.
//
// The task merges an open PR the instant its ruleset-required checks go green.
// It deliberately does NOT use gh pr merge --auto: native auto-merge is unreliable
// when required checks come from repository rulesets (community #162623), where
// --auto enables but never fires. Instead it polls and merges synchronously once
// green. When the branch is BEHIND (the develop-protection ruleset requires up to
// date), it updates the branch and re-polls rather than stalling. Three pure
// decisions are tested: decideAutoMerge (one-time precondition guard),
// decideMergeReady (per-poll MERGE/UPDATE/WAIT/BLOCKED), and the shared
// summarizeChecks green semantics reused from pr-follow.ts.
import { describe, it, expect } from 'vitest';
import {
  decideAutoMerge,
  decideMergeReady,
  summarizeChecks,
  type PrView,
  type CheckRun,
} from './pr-automerge.js';

const openReady: PrView = {
  number: 421,
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
};

describe('decideAutoMerge precondition guard', () => {
  it('ENABLES an open, non-draft, mergeable PR as an auto-merge candidate', () => {
    expect(decideAutoMerge(openReady).action).toBe('ENABLE');
  });

  it('allows UNKNOWN mergeability through, since GitHub recomputes it at merge time', () => {
    expect(decideAutoMerge({ ...openReady, mergeable: 'UNKNOWN' }).action).toBe('ENABLE');
  });

  it('is idempotent: SKIPS a PR that already has auto-merge enabled', () => {
    const d = decideAutoMerge({ ...openReady, autoMergeEnabled: true });
    expect(d.action).toBe('SKIP');
    expect(d.reason).toContain('already');
  });

  it('SKIPS an already-merged PR', () => {
    expect(decideAutoMerge({ ...openReady, state: 'MERGED' }).action).toBe('SKIP');
  });

  it('SKIPS a closed PR', () => {
    expect(decideAutoMerge({ ...openReady, state: 'CLOSED' }).action).toBe('SKIP');
  });

  it('BLOCKS a draft PR, naming draft', () => {
    const d = decideAutoMerge({ ...openReady, isDraft: true });
    expect(d.action).toBe('BLOCKED');
    expect(d.reason.toLowerCase()).toContain('draft');
  });

  it('BLOCKS a conflicting PR, naming conflict', () => {
    const d = decideAutoMerge({ ...openReady, mergeable: 'CONFLICTING' });
    expect(d.action).toBe('BLOCKED');
    expect(d.reason.toLowerCase()).toContain('conflict');
  });

  it('reports draft AND conflict together', () => {
    const d = decideAutoMerge({ ...openReady, isDraft: true, mergeable: 'CONFLICTING' });
    expect(d.action).toBe('BLOCKED');
    expect(d.reason.toLowerCase()).toContain('draft');
    expect(d.reason.toLowerCase()).toContain('conflict');
  });
});

const green3: CheckRun[] = [
  { name: 'CI', state: 'SUCCESS' },
  { name: 'Coverage gate', state: 'SUCCESS' },
  { name: 'promote', state: 'SKIPPED' },
];

describe('decideMergeReady per-poll decision', () => {
  it('MERGES when every check is green and the PR is CLEAN', () => {
    const d = decideMergeReady(summarizeChecks(green3), 'CLEAN');
    expect(d.action).toBe('MERGE');
  });

  it('MERGES when green and mergeStateStatus is HAS_HOOKS', () => {
    expect(decideMergeReady(summarizeChecks(green3), 'HAS_HOOKS').action).toBe('MERGE');
  });

  it('UPDATES the branch when green but BEHIND (ruleset requires up to date)', () => {
    const d = decideMergeReady(summarizeChecks(green3), 'BEHIND');
    expect(d.action).toBe('UPDATE');
    expect(d.reason.toLowerCase()).toContain('behind');
  });

  it('WAITS when a check is still pending, even if mergeState is CLEAN', () => {
    const checks: CheckRun[] = [...green3, { name: 'slow', state: 'IN_PROGRESS' }];
    expect(decideMergeReady(summarizeChecks(checks), 'CLEAN').action).toBe('WAIT');
  });

  it('does NOT update when BEHIND but a check is still pending -- checks come first', () => {
    const checks: CheckRun[] = [...green3, { name: 'slow', state: 'IN_PROGRESS' }];
    expect(decideMergeReady(summarizeChecks(checks), 'BEHIND').action).toBe('WAIT');
  });

  it('BLOCKS when a required check has failed', () => {
    const checks: CheckRun[] = [...green3, { name: 'flaky', state: 'FAILURE' }];
    const d = decideMergeReady(summarizeChecks(checks), 'CLEAN');
    expect(d.action).toBe('BLOCKED');
    expect(d.reason.toLowerCase()).toContain('failed');
  });

  it('BLOCKS a DIRTY (conflicting) PR even when checks are green', () => {
    expect(decideMergeReady(summarizeChecks(green3), 'DIRTY').action).toBe('BLOCKED');
  });

  it('WAITS when green but mergeState is UNKNOWN (GitHub not yet recomputed)', () => {
    expect(decideMergeReady(summarizeChecks(green3), 'UNKNOWN').action).toBe('WAIT');
  });

  it('WAITS on zero checks -- an ungated PR is never treated as green (confident-zero guard)', () => {
    const d = decideMergeReady(summarizeChecks([]), 'CLEAN');
    expect(d.action).toBe('WAIT');
  });
});

describe('summarizeChecks green semantics (reused from pr-follow)', () => {
  it('is green only when settled, no failures, and at least one check exists', () => {
    expect(summarizeChecks(green3).green).toBe(true);
    expect(summarizeChecks([]).green).toBe(false);
  });

  it('treats SKIPPED and NEUTRAL as passing, not failing', () => {
    const checks: CheckRun[] = [
      { name: 'a', state: 'SKIPPED' },
      { name: 'b', state: 'NEUTRAL' },
      { name: 'c', state: 'SUCCESS' },
    ];
    const s = summarizeChecks(checks);
    expect(s.green).toBe(true);
    expect(s.failed.length).toBe(0);
  });
});
