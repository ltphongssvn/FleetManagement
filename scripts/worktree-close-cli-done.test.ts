// scripts/worktree-close-cli-done.test.ts
// RED-first: --done must be reachable from the registered task, not merely
// present in the decision core.
//
// A capability the CLI cannot express is a capability that does not exist. The
// --retired arc learned this the hard way: the pure core was complete and
// unit-tested while no argv path reached it. These tests pin the wiring so the
// flag cannot regress into unreachability.
//
// Parsing rules mirror --retired exactly: opt-in, order-independent, and any
// unrecognised -- token is IGNORED rather than mistaken for the worktree path
// (a typo must not silently become the target directory).
import { describe, it, expect } from 'vitest';
import { parseCloseArgv, formatCloseReport } from './worktree-close-cli.js';
import { decideClose, makeCloseInput } from './close-worktree.js';

const WT = '/home/u/code/t106-wt1-driver-delete-audit';

describe('parseCloseArgv - --done', () => {
  it('defaults to false when absent', () => {
    expect(parseCloseArgv([WT]).done).toBe(false);
  });

  it('reads the flag after the path', () => {
    const a = parseCloseArgv([WT, '--done']);
    expect(a.done).toBe(true);
    expect(a.path).toBe(WT);
  });

  it('reads the flag before the path (order-independent)', () => {
    const a = parseCloseArgv(['--done', WT]);
    expect(a.done).toBe(true);
    expect(a.path).toBe(WT);
  });

  it('composes with --retired', () => {
    const a = parseCloseArgv([WT, '--retired', '--done']);
    expect(a.retired).toBe(true);
    expect(a.done).toBe(true);
    expect(a.path).toBe(WT);
  });

  it('never mistakes an unknown flag for the path', () => {
    const a = parseCloseArgv(['--dnoe', WT]);
    expect(a.done).toBe(false);
    expect(a.path).toBe(WT);
  });

  it('leaves path null when only flags are given', () => {
    expect(parseCloseArgv(['--done']).path).toBe(null);
  });
});

describe('formatCloseReport - done is auditable', () => {
  it('prints done in the state line so a permitted close states why', () => {
    const input = makeCloseInput({ idleHours: 0, done: true });
    const report = formatCloseReport(decideClose(input), input);
    expect(report).toContain('done=true');
    expect(report).toContain('idleH=0');
    expect(report).toContain('verdict:  remove');
  });

  it('prints done=false on an ordinary refusal', () => {
    const input = makeCloseInput({ idleHours: 0 });
    const report = formatCloseReport(decideClose(input), input);
    expect(report).toContain('done=false');
    expect(report).toContain('- recent');
  });
});
