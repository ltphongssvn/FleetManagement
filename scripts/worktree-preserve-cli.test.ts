// scripts/worktree-preserve-cli.test.ts
// GREEN (t85 worktree-preserve arc, 2026-08-05): the PURE surface of the
// //#worktree:preserve driver -- argv parsing, target assembly, and the git
// argv contracts of the write port.
//
// WHY THESE EXISTED UNTESTED FOR A WHILE, recorded so the gap is not
// rediscovered: scripts/ is measured by no coverage gate. test:scripts runs
// vitest with no --coverage, and the 90/90/90/90 threshold lives in the
// package-scoped test:coverage task, which cannot reach a directory belonging
// to no workspace package. When coverage only considers files imported by
// tests, an entirely untested file is ABSENT from the report rather than
// failing it -- so four exported helpers here were invisible, not flagged.
// The structural fix (an explicit include glob plus //#typecheck:scripts) is
// recorded as its own arc; this file closes the immediate gap.
//
// WHY THE PORT'S ARGV IS TESTABLE AT ALL. makeWritePort takes its runner as a
// PARAMETER, so the exact git commands are asserted against a stub without
// spawning git. That is the payoff of the factory-at-the-composition-root
// design: with a module-level port these contracts would have no entry point
// for testing, and the flags that make this tool safe -- --no-verify scoped to
// exactly two calls, -u on push, --untracked-files=all on status -- would be
// unverifiable.
//
// WHY ARGV IS ZOD-PARSED. process.argv is genuinely external input, Axis 1 of
// the two-axis rule. A green typecheck says nothing about what parseArgs hands
// over at RUNTIME, so the schema is asserted by execution rather than assumed.
import { describe, it, expect } from 'vitest';
import {
  buildPreserveTargets,
  makeWritePort,
  parsePreserveArgv,
  PreserveArgvSchema,
  statusArgs,
  type GitRunner,
} from './worktree-preserve-cli.js';
const NL = String.fromCharCode(10);
describe('parsePreserveArgv (consent is explicit and unforgeable)', () => {
  it('defaults to a dry run with no filter', () => {
    expect(parsePreserveArgv([])).toEqual({ execute: false, only: null });
  });
  it('accepts --execute as consent', () => {
    expect(parsePreserveArgv(['--execute']).execute).toBe(true);
  });
  it('does NOT treat a positional path as consent', () => {
    const a = parsePreserveArgv(['/wt/a']);
    expect(
      a.execute,
      'a path argument must never imply permission to write; consent is a separate explicit flag',
    ).toBe(false);
    expect(a.only).toBe('/wt/a');
  });
  it('THROWS on an unknown flag rather than silently ignoring it', () => {
    expect(
      () => parsePreserveArgv(['--exceute']),
      'a silently swallowed consent typo produces a survey the operator reads as a completed run',
    ).toThrow();
  });
  it('THROWS on a value given to the boolean consent flag', () => {
    expect(() => parsePreserveArgv(['--execute=yes'])).toThrow();
  });
  it('is order-independent for flag and positional', () => {
    const expected = { execute: true, only: '/wt/a' };
    expect(parsePreserveArgv(['--execute', '/wt/a'])).toEqual(expected);
    expect(parsePreserveArgv(['/wt/a', '--execute'])).toEqual(expected);
  });
  it('keeps the FIRST positional when several are given', () => {
    expect(parsePreserveArgv(['/wt/a', '/wt/b']).only).toBe('/wt/a');
  });
  it('produces a value the schema accepts, proving parseArgs and Zod agree at RUNTIME', () => {
    expect(PreserveArgvSchema.safeParse(parsePreserveArgv([])).success).toBe(true);
    expect(PreserveArgvSchema.safeParse(parsePreserveArgv(['--execute'])).success).toBe(true);
  });
  it('the schema REJECTS an empty filter string rather than treating it as a path', () => {
    expect(PreserveArgvSchema.safeParse({ execute: false, only: '' }).success).toBe(false);
  });
});
const ENTRIES = [
  { path: '/wt/primary', branch: 'main' },
  { path: '/wt/a', branch: 'feature/a' },
  { path: '/wt/detached', branch: null },
];
const DIRTY_OUT = [' M a.ts', '?? b.ts'].join(NL);
describe('buildPreserveTargets (which worktrees enter the sweep)', () => {
  it('pairs every worktree with its parsed dirty state', () => {
    const t = buildPreserveTargets(ENTRIES, null, () => DIRTY_OUT);
    expect(t.map((x) => x.path)).toEqual(['/wt/primary', '/wt/a', '/wt/detached']);
    expect(t.every((x) => x.entries.length === 2)).toBe(true);
  });
  it('carries a clean worktree through with no entries', () => {
    const t = buildPreserveTargets(ENTRIES, '/wt/a', () => '');
    expect(t.map((x) => x.entries)).toEqual([[]]);
  });
  it('narrows to a single worktree when a filter is given', () => {
    const t = buildPreserveTargets(ENTRIES, '/wt/a', () => DIRTY_OUT);
    expect(t.map((x) => x.path)).toEqual(['/wt/a']);
  });
  it('reads status ONLY for the filtered worktree', () => {
    const seen: string[] = [];
    buildPreserveTargets(ENTRIES, '/wt/a', (p) => {
      seen.push(p);
      return '';
    });
    expect(
      seen,
      'a filtered run must not shell out once per worktree across the whole fleet',
    ).toEqual(['/wt/a']);
  });
  it('THROWS on an unknown filter rather than sweeping nothing', () => {
    expect(
      () => buildPreserveTargets(ENTRIES, '/wt/nope', () => ''),
      'an empty sweep from a typo would exit 0 and read as success',
    ).toThrow();
  });
  it('names the known roots in the error so the typo is fixable', () => {
    expect(() => buildPreserveTargets(ENTRIES, '/wt/nope', () => '')).toThrow(/wt\/a/);
  });
  it('preserves a null branch so the runner can refuse it', () => {
    const t = buildPreserveTargets(ENTRIES, '/wt/detached', () => DIRTY_OUT);
    expect(t.map((x) => x.branch)).toEqual([null]);
  });
  it('is empty for an empty worktree list', () => {
    expect(buildPreserveTargets([], null, () => '')).toEqual([]);
  });
});
interface GitCall {
  args: readonly string[];
  cwd: string | undefined;
  timeoutMs: number | undefined;
}
function stubGit(result: string): { git: GitRunner; calls: GitCall[] } {
  const calls: GitCall[] = [];
  const git: GitRunner = (args, cwd, timeoutMs) => {
    calls.push({ args, cwd, timeoutMs });
    return result;
  };
  return { git, calls };
}
describe('makeWritePort (git argv contracts)', () => {
  it('stages everything, including untracked files', () => {
    const { git, calls } = stubGit('');
    makeWritePort(git).stageAll('/wt/a');
    expect(calls.map((c) => c.args)).toEqual([['add', '-A']]);
    expect(calls.map((c) => c.cwd)).toEqual(['/wt/a']);
  });
  it('commits with --no-verify: a WIP commit cannot pass the gates by definition', () => {
    const { git, calls } = stubGit('');
    makeWritePort(git).commit('/wt/a', 'wip: msg');
    expect(calls.map((c) => c.args)).toEqual([['commit', '--no-verify', '-m', 'wip: msg']]);
  });
  it('counts committed files by ASKING GIT, never by inference', () => {
    const { git, calls } = stubGit(['a.ts', 'b.ts', 'c.ts'].join(NL));
    expect(makeWritePort(git).countCommittedFiles('/wt/a')).toBe(3);
    expect(calls.map((c) => c.args)).toEqual([
      ['show', '--stat', '--name-only', '--format=', 'HEAD'],
    ]);
  });
  it('counts zero for an empty commit listing rather than throwing', () => {
    const { git } = stubGit('');
    expect(makeWritePort(git).countCommittedFiles('/wt/a')).toBe(0);
  });
  it('ignores blank lines when counting, so formatting cannot inflate the count', () => {
    const { git } = stubGit(['a.ts', '', '  ', 'b.ts'].join(NL));
    expect(
      makeWritePort(git).countCommittedFiles('/wt/a'),
      'an inflated count would turn a real shortfall into a false verified',
    ).toBe(2);
  });
  it('pushes with -u so the branch tracks, and bounds it more generously than a local read', () => {
    const { git, calls } = stubGit('');
    makeWritePort(git).pushBranch('/wt/a', 'feature/a');
    expect(calls.map((c) => c.args)).toEqual([
      ['push', '--no-verify', '-u', 'origin', 'feature/a'],
    ]);
    const timeouts = calls.map((c) => c.timeoutMs ?? 0);
    expect(Math.min(...timeouts)).toBeGreaterThan(60_000);
  });
  it('NEVER passes a flag that could rewrite history or force anything', () => {
    const { git, calls } = stubGit('');
    const port = makeWritePort(git);
    port.stageAll('/wt/a');
    port.commit('/wt/a', 'm');
    port.pushBranch('/wt/a', 'b');
    const all = calls.flatMap((c) => c.args).join(' ');
    expect(all.includes('--force')).toBe(false);
    expect(all.includes('--amend')).toBe(false);
    expect(all.includes('reset')).toBe(false);
    expect(all.includes('rebase')).toBe(false);
  });
});
describe('statusArgs (untracked files must be visible)', () => {
  it('requests porcelain v1 with ALL untracked files', () => {
    expect(statusArgs()).toEqual(['status', '--porcelain=v1', '--untracked-files=all']);
  });
  it('does NOT omit untracked files: that omission is what made stash lose them', () => {
    expect(statusArgs().join(' ')).toContain('--untracked-files=all');
  });
});
