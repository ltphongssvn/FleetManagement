// scripts/worktree-preserve-runner.test.ts
// GREEN (t85 worktree-preserve arc, 2026-08-05): the sweep, tested by
// EXECUTION.
//
// The git operations arrive as an injected port, so the invariants that matter
// are asserted by running the loop and inspecting what it DID:
//   dry-run          -> an EMPTY command log
//   detached HEAD    -> no commit attempted at all
//   count mismatch   -> reported as shortfall, never as success
//   count mismatch   -> NO PUSH
//   port THROWS      -> that target fails, the sweep CONTINUES
// None of that is reachable by reading source text, which is why an earlier
// draft's source-contract approach was abandoned for injection.
//
// THE SHORTFALL CASE IS THE REASON THIS FILE EXISTS. git stash create reported
// success while silently dropping untracked files -- 1 of 3 captured, then 2 of
// 4. A preservation tool that can appear to succeed while losing the payload is
// worse than no tool, so the count gate is exercised against a port that
// deliberately under-reports.
//
// THE THROW CASE IS THE SECOND REASON. Before this, an execFileSync failure on
// worktree 7 of 44 aborted the whole sweep -- possibly after committing to six
// worktrees and pushing none. That is the partial state the count gate exists
// to prevent, reintroduced one level up. The 2026 Node practice is to
// distinguish OPERATIONAL errors, which are handled at runtime, from programmer
// errors, and to fail fast but fail SAFELY: a failing external boundary must
// not crash the whole run. So a port throw is isolated to its own target.
//
// FIXTURES ARE NAMED CONSTANTS, NOT ARRAY INDICES, and that is a fix rather
// than a style choice: TARGETS[1] under noUncheckedIndexedAccess needs an
// assertion, and that assertion sits between two rules with opposite demands
// (non-nullable-type-assertion-style wants !, no-non-null-assertion forbids it)
// so eslint --fix made the file worse. Named constants have no index, so
// neither rule engages and no eslint-disable is needed.
import { describe, it, expect } from 'vitest';
import { PRESERVE_EXIT } from './worktree-preserve.js';
import {
  runPreserve,
  type PreserveTarget,
  type WorktreeWritePort,
} from './worktree-preserve-runner.js';
interface Call {
  op: string;
  path: string;
  detail?: string;
}
interface Recorded {
  port: WorktreeWritePort;
  calls: Call[];
}
// Records every port invocation. A dry run must leave this EMPTY -- the
// strongest possible statement that nothing was written.
function recorder(committedCount: (path: string) => number): Recorded {
  const calls: Call[] = [];
  const port: WorktreeWritePort = {
    stageAll: (path) => {
      calls.push({ op: 'stageAll', path });
    },
    commit: (path, message) => {
      calls.push({ op: 'commit', path, detail: message.split(String.fromCharCode(10))[0] });
    },
    countCommittedFiles: (path) => committedCount(path),
    pushBranch: (path, branch) => {
      calls.push({ op: 'pushBranch', path, detail: branch });
    },
  };
  return { port, calls };
}
// A port that throws on a chosen operation, to prove operational failures are
// isolated rather than fatal.
function throwingRecorder(failOn: 'stageAll' | 'commit' | 'push', onPath: string): Recorded {
  const calls: Call[] = [];
  const boom = (op: string, path: string): void => {
    calls.push({ op, path });
    if (path === onPath) throw new Error('simulated git failure in ' + op);
  };
  const port: WorktreeWritePort = {
    stageAll: (path) => {
      if (failOn === 'stageAll') boom('stageAll', path);
      else calls.push({ op: 'stageAll', path });
    },
    commit: (path) => {
      if (failOn === 'commit') boom('commit', path);
      else calls.push({ op: 'commit', path });
    },
    countCommittedFiles: () => 3,
    pushBranch: (path) => {
      if (failOn === 'push') boom('pushBranch', path);
      else calls.push({ op: 'pushBranch', path });
    },
  };
  return { port, calls };
}
function dirty(n: number): { path: string; staged: boolean; untracked: boolean }[] {
  return Array.from({ length: n }, (_unused, i) => ({
    path: 'f' + String(i) + '.ts',
    staged: false,
    untracked: true,
  }));
}
const CLEAN: PreserveTarget = { path: '/wt/clean', branch: 'feature/a', entries: [] };
const DIRTY: PreserveTarget = { path: '/wt/dirty', branch: 'feature/b', entries: dirty(3) };
const DIRTY2: PreserveTarget = { path: '/wt/dirty2', branch: 'feature/c', entries: dirty(3) };
const DETACHED: PreserveTarget = { path: '/wt/detached', branch: null, entries: dirty(2) };
const ALL: readonly PreserveTarget[] = [CLEAN, DIRTY, DETACHED];
describe('runPreserve: consent gates every write', () => {
  it('DRY RUN writes NOTHING, even with preservable work', () => {
    const { port, calls } = recorder(() => 3);
    const report = runPreserve(ALL, port, { execute: false });
    expect(
      calls.length,
      'a survey that commits is not a survey; the operator must be able to look without acting',
    ).toBe(0);
    expect(report.summary.preserved).toBe(0);
  });
  it('DRY RUN still REPORTS what it would preserve', () => {
    const { port } = recorder(() => 3);
    const report = runPreserve(ALL, port, { execute: false });
    expect(report.planned).toBe(1);
    expect(report.lines.join(' ')).toContain('/wt/dirty');
  });
  it('EXECUTE stages, commits and pushes exactly once for the dirty worktree', () => {
    const { port, calls } = recorder(() => 3);
    runPreserve(ALL, port, { execute: true });
    expect(calls.map((c) => c.op)).toEqual(['stageAll', 'commit', 'pushBranch']);
    expect(calls.every((c) => c.path === '/wt/dirty')).toBe(true);
  });
});
describe('runPreserve: never touches what it must not touch', () => {
  it('NEVER writes to a clean worktree', () => {
    const { port, calls } = recorder(() => 0);
    const report = runPreserve([CLEAN], port, { execute: true });
    expect(calls.length).toBe(0);
    expect(report.summary.skipped).toBe(1);
  });
  it('NEVER commits on a detached HEAD', () => {
    const { port, calls } = recorder(() => 2);
    const report = runPreserve([DETACHED], port, { execute: true });
    expect(
      calls.length,
      'a commit on a detached HEAD is reachable by no ref -- preserving there would BE the loss',
    ).toBe(0);
    expect(report.summary.refused).toBe(1);
  });
});
describe('runPreserve: the count gate', () => {
  it('verifies when every dirty file reached the commit', () => {
    const { port } = recorder(() => 3);
    const r = runPreserve([DIRTY], port, { execute: true });
    expect(r.summary.preserved).toBe(1);
    expect(r.summary.shortfall).toBe(0);
    expect(r.exitCode).toBe(PRESERVE_EXIT.ok);
  });
  it('REPORTS SHORTFALL when the port silently drops files', () => {
    const { port } = recorder(() => 1);
    const r = runPreserve([DIRTY], port, { execute: true });
    expect(
      r.summary.shortfall,
      'this is the exact stash failure: 1 of 3 captured, success reported',
    ).toBe(1);
    expect(r.summary.preserved).toBe(0);
    expect(r.exitCode).toBe(PRESERVE_EXIT.shortfall);
  });
  it('does NOT push when the count gate fails', () => {
    const { port, calls } = recorder(() => 1);
    runPreserve([DIRTY], port, { execute: true });
    expect(
      calls.some((c) => c.op === 'pushBranch'),
      'publishing an incomplete preservation would make the loss look durable',
    ).toBe(false);
  });
  it('names the shortfall in the report so it is actionable', () => {
    const { port } = recorder(() => 1);
    const r = runPreserve([DIRTY], port, { execute: true });
    const text = r.lines.join(' ');
    expect(text).toContain('/wt/dirty');
    expect(text.toLowerCase()).toContain('shortfall');
  });
});
// OPERATIONAL FAILURE ISOLATION. Every one of these would previously have
// thrown out of runPreserve and aborted the sweep.
describe('runPreserve: a port throw is isolated, never fatal', () => {
  it('does not throw when stageAll fails', () => {
    const { port } = throwingRecorder('stageAll', '/wt/dirty');
    expect(() => runPreserve([DIRTY], port, { execute: true })).not.toThrow();
  });
  it('records a commit failure as failed, not as preserved', () => {
    const { port } = throwingRecorder('commit', '/wt/dirty');
    const r = runPreserve([DIRTY], port, { execute: true });
    expect(r.summary.failed).toBe(1);
    expect(r.summary.preserved).toBe(0);
    expect(r.exitCode).toBe(PRESERVE_EXIT.failed);
  });
  it('CONTINUES the sweep after one worktree errors', () => {
    const { port, calls } = throwingRecorder('commit', '/wt/dirty');
    const r = runPreserve([DIRTY, DIRTY2], port, { execute: true });
    expect(
      calls.some((c) => c.path === '/wt/dirty2'),
      'one failing worktree must not strand the other forty-three',
    ).toBe(true);
    expect(r.summary.failed).toBe(1);
    expect(r.summary.preserved).toBe(1);
  });
  it('names the failing worktree and the reason in the report', () => {
    const { port } = throwingRecorder('commit', '/wt/dirty');
    const r = runPreserve([DIRTY], port, { execute: true });
    const text = r.lines.join(' ');
    expect(text).toContain('/wt/dirty');
    expect(text.toLowerCase()).toContain('failed');
    expect(text).toContain('simulated git failure');
  });
  it('a push failure is failed, not shortfall: the commit landed, only publishing did not', () => {
    const { port } = throwingRecorder('push', '/wt/dirty');
    const r = runPreserve([DIRTY], port, { execute: true });
    expect(
      r.summary.failed,
      'the work is committed and safe; conflating this with shortfall would overstate the risk',
    ).toBe(1);
    expect(r.summary.shortfall).toBe(0);
  });
});
describe('runPreserve: sweep behaviour', () => {
  it('continues after a refusal rather than abandoning the sweep', () => {
    const { port, calls } = recorder(() => 3);
    const r = runPreserve([DETACHED, DIRTY], port, { execute: true });
    expect(r.summary.refused).toBe(1);
    expect(r.summary.preserved).toBe(1);
    expect(calls.some((c) => c.path === '/wt/dirty')).toBe(true);
  });
  it('lets shortfall dominate refusal in the exit code', () => {
    const { port } = recorder(() => 0);
    const r = runPreserve([DETACHED, DIRTY], port, { execute: true });
    expect(r.exitCode).toBe(PRESERVE_EXIT.shortfall);
  });
  it('is a no-op on an empty target list', () => {
    const { port, calls } = recorder(() => 0);
    const r = runPreserve([], port, { execute: true });
    expect(calls.length).toBe(0);
    expect(r.exitCode).toBe(PRESERVE_EXIT.ok);
  });
});
