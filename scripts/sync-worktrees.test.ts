// scripts/sync-worktrees.test.ts
// RED spec for the pure classifier extracted from sync-worktrees.ts.
// classify() is a total, side-effect-free function: given an observed
// worktree state it returns a discriminated-union Action. No git, no I/O.
import { describe, it, expect } from 'vitest';
import {
  classify,
  gitExecOptions,
  GIT_READ_TIMEOUT_MS,
  GIT_NETWORK_TIMEOUT_MS,
} from './sync-worktrees.ts';

type St = Parameters<typeof classify>[0];
const base: St = {
  branch: 'feature/x',
  hasUpstream: true,
  originBranchExists: true,
  ahead: 0,
  behind: 0,
  isDirty: false,
};
const st = (o: Partial<St>): St => ({ ...base, ...o });

describe('classify (pure worktree-sync decision core)', () => {
  it('detached HEAD -> detached', () => {
    expect(classify(st({ branch: null })).kind).toBe('detached');
  });
  it('no upstream + no origin branch -> publish', () => {
    expect(classify(st({ hasUpstream: false, originBranchExists: false })).kind).toBe('publish');
  });
  it('no upstream + origin branch exists -> set-upstream', () => {
    expect(classify(st({ hasUpstream: false, originBranchExists: true })).kind).toBe(
      'set-upstream',
    );
  });
  it('ahead 0 behind 0 -> synced', () => {
    expect(classify(st({})).kind).toBe('synced');
  });
  it('behind only + clean -> ff', () => {
    expect(classify(st({ behind: 3 })).kind).toBe('ff');
  });
  it('behind only + dirty -> blocked{dirty} (the crash, now terminal)', () => {
    const r = classify(st({ behind: 3, isDirty: true }));
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') expect(r.reason).toBe('dirty');
  });
  it('ahead only -> ahead (leave)', () => {
    expect(classify(st({ ahead: 2 })).kind).toBe('ahead');
  });
  it('ahead AND behind -> blocked{diverged-remote} (never auto-reconcile)', () => {
    const r = classify(st({ ahead: 2, behind: 3 }));
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') expect(r.reason).toBe('diverged-remote');
  });
});

describe('gitExecOptions (execFileSync timeout policy -- prevents the 4h push hang)', () => {
  it('always sets a bounded timeout and SIGTERM killSignal (never unbounded)', () => {
    const o = gitExecOptions(['status', '--porcelain']);
    expect(typeof o.timeout).toBe('number');
    expect(o.timeout).toBeGreaterThan(0);
    expect(o.killSignal).toBe('SIGTERM');
  });
  it('uses the SHORT read timeout for read-only git commands', () => {
    expect(gitExecOptions(['status', '--porcelain']).timeout).toBe(GIT_READ_TIMEOUT_MS);
    expect(gitExecOptions(['rev-parse', 'HEAD']).timeout).toBe(GIT_READ_TIMEOUT_MS);
  });
  it('uses the LONGER network timeout for push (the operation that hung 4h17m)', () => {
    expect(gitExecOptions(['push', '-u', 'origin', 'feature/x']).timeout).toBe(
      GIT_NETWORK_TIMEOUT_MS,
    );
  });
  it('uses the network timeout for fetch', () => {
    expect(gitExecOptions(['fetch', '--all', '--prune']).timeout).toBe(GIT_NETWORK_TIMEOUT_MS);
  });
  it('network timeout is generous but still finite and larger than the read timeout', () => {
    expect(GIT_NETWORK_TIMEOUT_MS).toBeGreaterThan(GIT_READ_TIMEOUT_MS);
    expect(Number.isFinite(GIT_NETWORK_TIMEOUT_MS)).toBe(true);
  });
  it('passes through cwd when provided', () => {
    expect(gitExecOptions(['status'], '/tmp/x').cwd).toBe('/tmp/x');
  });
});
