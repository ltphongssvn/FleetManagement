// scripts/estate-verify-cli.test.ts
// The driver's pure halves: argv, and the porcelain record parser.
//
// parseWorktreeRecords is where a real defect would hide. `git worktree list
// --porcelain` is a blank-line-separated record format whose optional markers
// are BARE lines -- `locked`, `prunable` -- or lines carrying a reason, and a
// detached worktree emits NO `branch` line at all. Every one of those shapes
// has bitten this repo before: sweep-worktrees-cli.ts documents that passing
// detached entries through unfiltered made "the entire sweep THROW the moment
// one detached worktree exists anywhere in the estate", found only because
// scripts/ had never been typechecked.
//
// The fixtures below are shapes from git's own documentation, not invented
// ones, because a parser tested against imagined input proves only that it
// matches the imagination.
import { describe, it, expect } from 'vitest';
import { parseEstateArgv, parseWorktreeRecords } from './estate-verify-cli.ts';

const NL = String.fromCharCode(10);

describe('parseEstateArgv', () => {
  it('defaults quiet to false', () => {
    expect(parseEstateArgv([])).toEqual({ quiet: false, expectDigest: null });
  });

  it('reads --quiet', () => {
    expect(parseEstateArgv(['--quiet'])).toEqual({ quiet: true, expectDigest: null });
  });

  // A swallowed typo would print a confident verdict from a command the
  // operator did not mean to run.
  it('THROWS on an unknown flag rather than ignoring it', () => {
    expect(() => parseEstateArgv(['--quiett'])).toThrow();
    expect(() => parseEstateArgv(['--json'])).toThrow();
  });

  it('THROWS on a stray positional, since this task takes no path', () => {
    expect(() => parseEstateArgv(['/some/worktree'])).toThrow();
  });
});

describe('parseWorktreeRecords', () => {
  it('reads path and branch from a plain record', () => {
    const recs = parseWorktreeRecords(
      ['worktree /c/main', 'HEAD abc123', 'branch refs/heads/develop', ''].join(NL),
    );
    expect(recs).toEqual([
      { path: '/c/main', branch: 'develop', locked: false, prunable: false },
    ]);
  });

  it('reads several records separated by blank lines', () => {
    const recs = parseWorktreeRecords([
      'worktree /c/a', 'HEAD a1', 'branch refs/heads/feat/a', '',
      'worktree /c/b', 'HEAD b1', 'branch refs/heads/feat/b', '',
    ].join(NL));
    expect(recs.map((r) => r.path)).toEqual(['/c/a', '/c/b']);
    expect(recs.map((r) => r.branch)).toEqual(['feat/a', 'feat/b']);
  });

  // No branch line at all -- the shape that made the sweep throw.
  it('labels a detached worktree instead of dropping or crashing', () => {
    const recs = parseWorktreeRecords(
      ['worktree /c/bisect', 'HEAD 1234abc', 'detached', ''].join(NL),
    );
    expect(recs).toEqual([
      { path: '/c/bisect', branch: '(detached)', locked: false, prunable: false },
    ]);
  });

  it('reads a BARE locked marker', () => {
    const recs = parseWorktreeRecords(
      ['worktree /c/l', 'HEAD a1', 'branch refs/heads/x', 'locked', ''].join(NL),
    );
    expect(recs[0]?.locked).toBe(true);
  });

  it('reads a locked marker carrying a reason', () => {
    const recs = parseWorktreeRecords(
      ['worktree /c/l', 'HEAD a1', 'branch refs/heads/x', 'locked being edited', ''].join(NL),
    );
    expect(recs[0]?.locked).toBe(true);
  });

  it('reads a prunable marker and its reason', () => {
    const recs = parseWorktreeRecords([
      'worktree /c/p', 'HEAD a1', 'detached',
      'prunable gitdir file points to non-existent location', '',
    ].join(NL));
    expect(recs[0]?.prunable).toBe(true);
    expect(recs[0]?.branch).toBe('(detached)');
  });

  it('carries both markers on one record', () => {
    const recs = parseWorktreeRecords(
      ['worktree /c/x', 'HEAD a1', 'branch refs/heads/x', 'locked', 'prunable', ''].join(NL),
    );
    expect(recs[0]?.locked).toBe(true);
    expect(recs[0]?.prunable).toBe(true);
  });

  // A bare main repository emits `bare` and no branch.
  it('handles a bare main repository record', () => {
    const recs = parseWorktreeRecords(['worktree /c/bare', 'bare', ''].join(NL));
    expect(recs).toEqual([
      { path: '/c/bare', branch: '(detached)', locked: false, prunable: false },
    ]);
  });

  it('returns nothing for empty input rather than a phantom record', () => {
    expect(parseWorktreeRecords('')).toEqual([]);
  });

  // Markers before any worktree line are malformed; they must not attach
  // themselves to the first real record that follows.
  it('ignores stray lines that precede the first worktree', () => {
    const recs = parseWorktreeRecords(
      ['locked', 'prunable', 'worktree /c/a', 'branch refs/heads/x', ''].join(NL),
    );
    expect(recs).toEqual([
      { path: '/c/a', branch: 'x', locked: false, prunable: false },
    ]);
  });
});

// ---- the confident zero, encoded ----
// git worktree list --porcelain can exit 0 and yet yield NO worktree records:
// a format change, a wrapper, an unexpected mode. Nothing throws, no record
// fails to parse, and classifyEstate([]) is legitimately clean -- so the run
// reported "estate clean: 0 worktree(s) checked", severity INFO, exit 0.
// Success, from an estate nobody could read.
//
// The decisive fact is domain, not syntax: `git worktree list` in ANY valid
// repository lists at least the MAIN worktree. Zero records is therefore never
// a legitimate answer, and the driver now refuses rather than classifying.
// This is the same shape as an exit-0-with-empty-stdout serialization failure,
// and the hazard stack:stop and docker:reclaim both guard, where an unreachable
// daemon looks exactly like an idle host.
describe('parseWorktreeRecords: zero records is not an empty estate', () => {
  it('yields nothing for output that mentions no worktree', () => {
    expect(parseWorktreeRecords('fatal: not a git repository')).toEqual([]);
  });

  it('yields nothing for empty output', () => {
    expect(parseWorktreeRecords('')).toEqual([]);
  });

  // A plausible future format: the key renamed, everything else intact.
  it('yields nothing when the record key changes under us', () => {
    const renamed = ['tree /c/a', 'HEAD a1', 'branch refs/heads/x', ''].join(NL);
    expect(parseWorktreeRecords(renamed)).toEqual([]);
  });

  // The positive control: real porcelain always yields at least one record,
  // which is why zero can be treated as a failure signal.
  it('always yields at least one record for real porcelain', () => {
    const real = ['worktree /c/main', 'HEAD abc', 'branch refs/heads/develop', ''].join(NL);
    expect(parseWorktreeRecords(real).length).toBeGreaterThan(0);
  });
});

// ---- a malformed digest is a USAGE error, not a stale estate ----
// parseArgs owns the SURFACE and rejects an unknown flag NAME. It does not
// look at VALUES, so --expect-digest=garbage parsed happily as a string --
// and the garbage then failed the comparison in decideEstate, producing STALE
// and REREAD_ESTATE. That tells the operator the estate moved when the truth
// is that the digest is malformed: a remedy that can never succeed, and for an
// agent an unbounded retry loop, since re-reading never makes garbage match.
//
// Zod owns the CONTRACT, which is the 2026 split. A bad flag VALUE now takes
// the same path as a bad flag NAME: throw, exit 2, usage line.
describe('--expect-digest is validated, not merely accepted', () => {
  const REAL = 'a'.repeat(64);

  it('accepts a well-formed sha256 digest', () => {
    expect(parseEstateArgv(['--expect-digest=' + REAL]).expectDigest).toBe(REAL);
  });

  it('accepts its absence, since the precondition is opt-in', () => {
    expect(parseEstateArgv([]).expectDigest).toBeNull();
  });

  // Each of these previously became a STALE verdict instead of a usage error.
  it('THROWS on a digest that is not a digest', () => {
    for (const bad of ['garbage', '', 'abc', 'A'.repeat(64), 'g'.repeat(64)]) {
      expect(() => parseEstateArgv(['--expect-digest=' + bad])).toThrow();
    }
  });

  it('THROWS on a digest of the wrong length', () => {
    expect(() => parseEstateArgv(['--expect-digest=' + 'a'.repeat(63)])).toThrow();
    expect(() => parseEstateArgv(['--expect-digest=' + 'a'.repeat(65)])).toThrow();
  });

  // Uppercase hex is the sharp one: it LOOKS like a digest, and would have
  // compared unequal against our lowercase output forever.
  it('THROWS on uppercase hex, which would never match our own output', () => {
    expect(() => parseEstateArgv(['--expect-digest=' + 'A1B2'.repeat(16)])).toThrow();
  });

  it('still rejects an unknown flag, as it always did', () => {
    expect(() => parseEstateArgv(['--expect-diggest=' + REAL])).toThrow();
  });
});
