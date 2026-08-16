// scripts/terminal-registry.test.ts
// RED: the terminal number must be allocated from the REMOTE, not from local
// worktrees.
//
// THE DEFECT. `t<N>-wt<M>-<slug>` numbers are allocated from the
// sync:worktrees census, which reads `git worktree list` -- LOCAL worktrees on
// ONE machine. This repo is developed from two laptops sharing one remote, so
// each sees only its own half of the sequence. The MacBook census reported a
// high-water of t77 while the WSL2 laptop was already at t88, and t78 was cut
// on top of a terminal that had been in use for ten allocations. The same
// class produced the t16 -> t19 rename three months earlier.
//
// Worse, the census FORGETS: closing a worktree removes it from
// `git worktree list`, so the high-water DROPS. After t89 closed, the local
// census reported t77 again and would have re-issued t78.
//
// THE FIX. Allocate from the remote ref namespace -- the one place git is
// designed for concurrent access (append-only, server-side locking). Each cut
// publishes refs/terminals/<N>; the ceiling is the max over
// refs/remotes/origin/terminals/*, which every machine already has after the
// fetch --prune that sync:worktrees performs at startup.
//
// The refs are never deleted, so a closed worktree cannot lower the ceiling.
import { describe, it, expect } from 'vitest';
import {
  terminalRefName,
  parseTerminalRefs,
  nextTerminalNumber,
  worktreeDirName,
  listTerminalRefsArgs,
  claimTerminalArgs,
  claimBlobContent,
  formatTerminalCensus,
} from './terminal-registry.js';

describe('terminalRefName', () => {
  it('namespaces under refs/terminals so it cannot collide with branches', () => {
    expect(terminalRefName(90)).toBe('refs/terminals/90');
  });

  it('rejects a non-positive or non-integer terminal', () => {
    expect(() => terminalRefName(0)).toThrow();
    expect(() => terminalRefName(-1)).toThrow();
    expect(() => terminalRefName(1.5)).toThrow();
  });
});

describe('parseTerminalRefs', () => {
  it('reads the numbers out of remote-tracking terminal refs', () => {
    expect(parseTerminalRefs([
      'refs/remotes/origin/terminals/77',
      'refs/remotes/origin/terminals/88',
      'refs/remotes/origin/terminals/89',
    ])).toEqual([77, 88, 89]);
  });

  it('ignores refs that are not terminal refs', () => {
    expect(parseTerminalRefs([
      'refs/remotes/origin/develop',
      'refs/remotes/origin/chore/turbo-2-10-9',
      'refs/remotes/origin/terminals/42',
    ])).toEqual([42]);
  });

  // A ref whose leaf is not a bare integer is corrupt, not a terminal. Reading
  // it as 0 would let a malformed ref silently lower the ceiling.
  it('ignores a malformed leaf rather than reading it as zero', () => {
    expect(parseTerminalRefs([
      'refs/remotes/origin/terminals/abc',
      'refs/remotes/origin/terminals/12x',
      'refs/remotes/origin/terminals/7',
    ])).toEqual([7]);
  });

  it('returns empty for no refs at all (first ever allocation)', () => {
    expect(parseTerminalRefs([])).toEqual([]);
  });
});

describe('nextTerminalNumber', () => {
  it('is one past the highest PUBLISHED terminal, across machines', () => {
    expect(nextTerminalNumber([77, 88, 89])).toBe(90);
  });

  it('does not care about ordering', () => {
    expect(nextTerminalNumber([89, 12, 88])).toBe(90);
  });

  // The whole point: a closed worktree leaves its ref behind, so the ceiling
  // never drops and a number is never re-issued.
  it('starts at 1 only when nothing has ever been published', () => {
    expect(nextTerminalNumber([])).toBe(1);
  });
});

describe('worktreeDirName', () => {
  it('builds the conventional t<N>-wt<M>-<slug> name', () => {
    expect(worktreeDirName(90, 1, 'worktree-terminal-registry'))
      .toBe('t90-wt1-worktree-terminal-registry');
  });

  it('rejects a slug that would produce an ambiguous directory', () => {
    expect(() => worktreeDirName(90, 1, '')).toThrow();
    expect(() => worktreeDirName(90, 1, 'has spaces')).toThrow();
    expect(() => worktreeDirName(90, 1, 'Has/Slash')).toThrow();
  });
});

// ---- pure argv planners for the shell (same shape as worktree-close-cli) ----
// git calls stay in the driver; the argv these produce is asserted here so the
// commands are verified without spawning git.
describe('git argv planners', () => {
  // A PREFIX, never a mid-path wildcard. for-each-ref matches whole path
  // components, so 'refs/remotes/*/terminals/' matches nothing and returns an
  // empty list -- indistinguishable from "no terminals claimed", which would
  // re-issue terminal 1. Caught live against a registry holding 89 and 90.
  it('lists by prefix so the glob cannot silently match nothing', () => {
    expect(listTerminalRefsArgs()).toStrictEqual([
      'for-each-ref', '--format=%(refname)', 'refs/remotes/',
    ]);
  });

  it('the pattern contains no mid-path wildcard', () => {
    expect(listTerminalRefsArgs().some((a) => a.includes('*/'))).toBe(false);
  });

  // --force-with-lease=<ref>: with an EMPTY expect is git's documented
  // create-if-absent CAS, not a force. It is what makes a second machine's
  // claim of the same terminal fail instead of silently overwriting.
  it('claims with a create-if-absent lease on the exact ref', () => {
    const args = claimTerminalArgs(90, 'a'.repeat(40));
    expect(args[0]).toBe('push');
    expect(args).toContain('--force-with-lease=refs/terminals/90:');
    expect(args[args.length - 1]).toBe('a'.repeat(40) + ':refs/terminals/90');
  });

  // Unconditional force would overwrite another machine's claim and
  // reintroduce the collision this module exists to prevent.
  it('never force-pushes unconditionally', () => {
    const args = claimTerminalArgs(90, 'a'.repeat(40));
    expect(args).not.toContain('--force');
    expect(args).not.toContain('-f');
  });

  it('rejects claiming a non-positive terminal', () => {
    expect(() => claimTerminalArgs(0, 'a'.repeat(40))).toThrow(/positive integer/);
  });
});

describe('claimBlobContent', () => {
  // The blob must differ per machine: an IDENTICAL object makes git
  // short-circuit the push before the lease is evaluated, so both claims
  // succeed. Proven live before this test existed.
  it('differs between machines claiming at the same instant', () => {
    const at = '2026-08-08T00:00:00.000Z';
    expect(claimBlobContent('macbook', at)).not.toBe(claimBlobContent('wsl2', at));
  });

  it('records who claimed and when', () => {
    const c = claimBlobContent('macbook', '2026-08-08T00:00:00.000Z');
    expect(c).toContain('macbook');
    expect(c).toContain('2026-08-08T00:00:00.000Z');
  });

  it('rejects empty provenance', () => {
    expect(() => claimBlobContent('', '2026-08-08T00:00:00.000Z')).toThrow();
    expect(() => claimBlobContent('macbook', '')).toThrow();
  });
});

// ---- census wiring ----
// The registry is only useful if the number reaches the operator. sync:worktrees
// prints the census that terminal numbers are read from, so the ceiling belongs
// in its summary -- otherwise the correct answer exists but nobody sees it, and
// the local high-water gets used again out of habit.
describe('formatTerminalCensus', () => {
  it('states the next terminal so it can be read straight from the census', () => {
    expect(formatTerminalCensus([89, 90])).toContain('next terminal: t91');
  });

  it('reports how many terminals are published, across machines', () => {
    expect(formatTerminalCensus([89, 90])).toContain('2 published');
  });

  // An empty registry is AMBIGUOUS: either nothing was ever claimed, or the
  // refs were never fetched. Saying "t1" flatly would re-issue a burned number,
  // so the line must flag it rather than answer confidently.
  it('warns instead of confidently answering t1 when the registry is empty', () => {
    const s = formatTerminalCensus([]);
    expect(s).toMatch(/not fetched|no terminals/i);
    expect(s).not.toContain('next terminal: t1');
  });
});
