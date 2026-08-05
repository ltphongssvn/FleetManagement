// scripts/worktree-preserve-runner.test.ts
// RED (t85 worktree-preserve arc, 2026-08-05): the sweep, tested by EXECUTION.
//
// The git operations arrive as an injected port, so the invariants that matter
// are asserted by running the loop and inspecting what it DID:
//   dry-run          -> an EMPTY command log
//   detached HEAD    -> no commit attempted at all
//   count mismatch   -> reported as shortfall, never as success
// None of that is reachable by reading source text, which is why the earlier
// draft's source-contract approach was abandoned for injection.
//
// THE SHORTFALL CASE IS THE REASON THIS FILE EXISTS. git stash create reported
// success while silently dropping untracked files -- 1 of 3 captured, then 2 of
// 4. A preservation tool that can appear to succeed while losing the payload is
// worse than no tool, so the count gate is exercised here against a port that
// deliberately under-reports.
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
// Records every port invocation. A dry run must leave this EMPTY -- the
// strongest possible statement that nothing was written.
function recorder(committedCount: (path: string) => number): {
  port: WorktreeWritePort;
  calls: Call[];
} {
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
const dirty = (n: number): { path: string; staged: boolean; untracked: boolean }[] =>
  Array.from({ length: n }, (_, i) => ({ path: 'f' + String(i) + '.ts', staged: false, untracked: true }));
const TARGETS: PreserveTarget[] = [
  { path: '/wt/clean', branch: 'feature/a', entries: [] },
  { path: '/wt/dirty', branch: 'feature/b', entries: dirty(3) },
  { path: '/wt/detached', branch: null, entries: dirty(2) },
];
describe('runPreserve: consent gates every write', () => {
  it('DRY RUN writes NOTHING, even with preservable work', () => {
    const { port, calls } = recorder(() => 3);
    const report = runPreserve(TARGETS, port, { execute: false });
    expect(
      calls.length,
      'a survey that commits is not a survey; the operator must be able to look without acting',
    ).toBe(0);
    expect(report.summary.preserved).toBe(0);
  });
  it('DRY RUN still REPORTS what it would preserve', () => {
    const { port } = recorder(() => 3);
    const report = runPreserve(TARGETS, port, { execute: false });
    expect(report.planned).toBe(1);
    expect(report.lines.join(' ')).toContain('/wt/dirty');
  });
  it('EXECUTE stages, commits and pushes exactly once for the dirty worktree', () => {
    const { port, calls } = recorder(() => 3);
    runPreserve(TARGETS, port, { execute: true });
    expect(calls.map((c) => c.op)).toEqual(['stageAll', 'commit', 'pushBranch']);
    expect(calls.every((c) => c.path === '/wt/dirty')).toBe(true);
  });
});
describe('runPreserve: never touches what it must not touch', () => {
  it('NEVER writes to a clean worktree', () => {
    const { port, calls } = recorder(() => 0);
    const report = runPreserve([TARGETS[0] as PreserveTarget], port, { execute: true });
    expect(calls.length).toBe(0);
    expect(report.summary.skipped).toBe(1);
  });
  it('NEVER commits on a detached HEAD', () => {
    const { port, calls } = recorder(() => 2);
    const report = runPreserve([TARGETS[2] as PreserveTarget], port, { execute: true });
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
    const r = runPreserve([TARGETS[1] as PreserveTarget], port, { execute: true });
    expect(r.summary.preserved).toBe(1);
    expect(r.summary.shortfall).toBe(0);
    expect(r.exitCode).toBe(PRESERVE_EXIT.ok);
  });
  it('REPORTS SHORTFALL when the port silently drops files', () => {
    const { port } = recorder(() => 1);
    const r = runPreserve([TARGETS[1] as PreserveTarget], port, { execute: true });
    expect(
      r.summary.shortfall,
      'this is the exact stash failure: 1 of 3 captured, success reported',
    ).toBe(1);
    expect(r.summary.preserved).toBe(0);
    expect(r.exitCode).toBe(PRESERVE_EXIT.shortfall);
  });
  it('does NOT push when the count gate fails', () => {
    const { port, calls } = recorder(() => 1);
    runPreserve([TARGETS[1] as PreserveTarget], port, { execute: true });
    expect(
      calls.some((c) => c.op === 'pushBranch'),
      'publishing an incomplete preservation would make the loss look durable',
    ).toBe(false);
  });
  it('names the shortfall in the report so it is actionable', () => {
    const { port } = recorder(() => 1);
    const r = runPreserve([TARGETS[1] as PreserveTarget], port, { execute: true });
    const text = r.lines.join(' ');
    expect(text).toContain('/wt/dirty');
    expect(text.toLowerCase()).toContain('shortfall');
  });
});
describe('runPreserve: sweep behaviour', () => {
  it('continues after a refusal rather than abandoning the sweep', () => {
    const { port, calls } = recorder(() => 3);
    const r = runPreserve(
      [TARGETS[2] as PreserveTarget, TARGETS[1] as PreserveTarget],
      port,
      { execute: true },
    );
    expect(r.summary.refused).toBe(1);
    expect(r.summary.preserved).toBe(1);
    expect(calls.some((c) => c.path === '/wt/dirty')).toBe(true);
  });
  it('lets shortfall dominate refusal in the exit code', () => {
    const { port } = recorder(() => 0);
    const r = runPreserve(
      [TARGETS[2] as PreserveTarget, TARGETS[1] as PreserveTarget],
      port,
      { execute: true },
    );
    expect(r.exitCode).toBe(PRESERVE_EXIT.shortfall);
  });
  it('is a no-op on an empty target list', () => {
    const { port, calls } = recorder(() => 0);
    const r = runPreserve([], port, { execute: true });
    expect(calls.length).toBe(0);
    expect(r.exitCode).toBe(PRESERVE_EXIT.ok);
  });
});
