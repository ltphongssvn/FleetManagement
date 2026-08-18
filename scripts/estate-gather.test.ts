// scripts/estate-gather.test.ts
// THE CONFIDENT ZERO, closed where it actually lived.
//
// gatherOne called a helper that swallowed the exit code and returned '' on
// failure, and countLines('') is 0. A failed `git status --porcelain` therefore
// read as a CLEAN working tree and a failed `git stash list` as NO STASHES --
// the schema powerless to help, because 0 is a well-formed count that simply
// is not true.
//
// It survived because gatherOne sat under a v8-ignore: it spawned git, so
// nothing could observe it. These tests exist because the mapping is now pure.
import { describe, it, expect } from 'vitest';
import type { GitOutcome } from './estate-gather.js';
import {
  GitOutcomeSchema,
  WorktreeReadingsSchema,
  gatherOneFrom,
  type WorktreeReadings,
} from './estate-gather.js';

const REC = { path: '/c/a', branch: 'feat/x', prunable: false, locked: false };
const ran = (out: string): GitOutcome => ({ ok: true, out });
const failed = { ok: false as const };

/** Every reading succeeded and reported nothing: a genuinely clean worktree. */
const ALL_CLEAN: WorktreeReadings = {
  upstream: ran(''), ahead: ran(''), status: ran(''), stash: ran(''),
};

describe('a failed command is never a zero', () => {
  // THE DEFECT. Before, this produced dirtyFileCount 0 and reported clean.
  it('REFUSES when git status could not run, rather than reporting clean', () => {
    const g = gatherOneFrom(REC, { ...ALL_CLEAN, status: failed });
    expect(g.kind).toBe('git-failed');
  });

  it('REFUSES when git stash list could not run, rather than reporting none', () => {
    const g = gatherOneFrom(REC, { ...ALL_CLEAN, stash: failed });
    expect(g.kind).toBe('git-failed');
  });

  // The same zero wearing a different hat: a failed count became "not ahead".
  it('REFUSES when the ahead count could not run against a real upstream', () => {
    const g = gatherOneFrom(REC, {
      upstream: ran('origin/feat/x'), ahead: failed, status: ran(''), stash: ran(''),
    });
    expect(g.kind).toBe('git-failed');
  });

  // The contrast that makes the point: EMPTY is a fact, FAILED is not.
  it('reports clean when the commands RAN and printed nothing', () => {
    const g = gatherOneFrom(REC, ALL_CLEAN);
    expect(g.kind).toBe('state');
    if (g.kind !== 'state') throw new Error('expected state');
    expect(g.state.dirtyFileCount).toBe(0);
    expect(g.state.stashCount).toBe(0);
    expect(g.state.aheadOfRemote).toBe(0);
  });
});

// The ONE call whose failure is normal, observed on the driver's first live
// run: a branch with no upstream cannot be ahead of one.
describe('no upstream is a state, not a failure', () => {
  it('accepts a branch with no upstream and reports zero ahead', () => {
    const g = gatherOneFrom(REC, { ...ALL_CLEAN, upstream: failed });
    expect(g.kind).toBe('state');
    if (g.kind !== 'state') throw new Error('expected state');
    expect(g.state.aheadOfRemote).toBe(0);
  });

  it('accepts an upstream lookup that ran and printed nothing', () => {
    expect(gatherOneFrom(REC, ALL_CLEAN).kind).toBe('state');
  });

  // With no upstream, the ahead count is never consulted, so its failure is
  // irrelevant -- the tool must not refuse over a reading it did not need.
  it('ignores a failed ahead count when there is no upstream to count against', () => {
    const g = gatherOneFrom(REC, { ...ALL_CLEAN, upstream: failed, ahead: failed });
    expect(g.kind).toBe('state');
  });
});

describe('counts are read from output that actually ran', () => {
  it('counts dirty files by line', () => {
    const g = gatherOneFrom(REC, { ...ALL_CLEAN, status: ran([' M a', '?? b', ' D c'].join('\n')) });
    if (g.kind !== 'state') throw new Error('expected state');
    expect(g.state.dirtyFileCount).toBe(3);
  });

  it('counts stashes by line', () => {
    const g = gatherOneFrom(REC, { ...ALL_CLEAN, stash: ran(['stash@{0}: x', 'stash@{1}: y'].join('\n')) });
    if (g.kind !== 'state') throw new Error('expected state');
    expect(g.state.stashCount).toBe(2);
  });

  it('reads the ahead count when an upstream exists', () => {
    const g = gatherOneFrom(REC, {
      upstream: ran('origin/feat/x'), ahead: ran('7'), status: ran(''), stash: ran(''),
    });
    if (g.kind !== 'state') throw new Error('expected state');
    expect(g.state.aheadOfRemote).toBe(7);
  });

  // git prints a decimal; anything else means the output format moved.
  it('REFUSES a count that is not a whole number', () => {
    for (const out of ['not-a-number', '3.5', '-1', 'NaN']) {
      const g = gatherOneFrom(REC, {
        upstream: ran('origin/x'), ahead: ran(out), status: ran(''), stash: ran(''),
      });
      expect(g.kind).toBe('git-failed');
    }
  });
});

// A schema rejection is DISTINCT from a git failure: the commands ran fine and
// the resulting record is simply not a worktree we can reason about.
describe('a rejected record is named separately from a failed command', () => {
  it('rejects a relative path without calling it a git failure', () => {
    const g = gatherOneFrom({ ...REC, path: 'relative/thing' }, ALL_CLEAN);
    expect(g.kind).toBe('rejected');
  });

  it('rejects a branch carrying a control character', () => {
    const g = gatherOneFrom({ ...REC, branch: 'feat/' + String.fromCharCode(27) }, ALL_CLEAN);
    expect(g.kind).toBe('rejected');
  });

  it('carries the markers through onto the state', () => {
    const g = gatherOneFrom({ ...REC, prunable: true, locked: true }, ALL_CLEAN);
    if (g.kind !== 'state') throw new Error('expected state');
    expect(g.state.prunable).toBe(true);
    expect(g.state.locked).toBe(true);
  });
});

// The outcome shape itself is a contract: the shell hands these across, and the
// whole fix rests on failure being unrepresentable as an empty string.
describe('an outcome cannot conflate empty with failed', () => {
  it('accepts a command that ran, with or without output', () => {
    expect(GitOutcomeSchema.safeParse({ ok: true, out: '' }).success).toBe(true);
    expect(GitOutcomeSchema.safeParse({ ok: true, out: 'x' }).success).toBe(true);
  });

  it('accepts a command that failed, which carries no output at all', () => {
    expect(GitOutcomeSchema.safeParse({ ok: false }).success).toBe(true);
  });

  // The shape that would reintroduce the bug: a failure pretending to output.
  it('REJECTS a failure that claims output', () => {
    expect(GitOutcomeSchema.safeParse({ ok: false, out: '' }).success).toBe(false);
  });

  it('REJECTS a success with no output field, which would read as undefined', () => {
    expect(GitOutcomeSchema.safeParse({ ok: true }).success).toBe(false);
  });

  it('REJECTS a readings set missing a command', () => {
    expect(WorktreeReadingsSchema.safeParse({ upstream: ran(''), status: ran('') }).success)
      .toBe(false);
  });
});
