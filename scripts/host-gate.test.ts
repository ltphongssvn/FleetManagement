// scripts/host-gate.test.ts
// RED->GREEN spec for the host-level integration-gate guard.
//
// Root cause this module addresses: this repo runs 40+ git worktrees on ONE
// WSL host. Container-backed integration gates are already serialized WITHIN a
// run (apps/api/vitest.integration.config.ts sets fileParallelism:false and
// sequence.concurrent:false), yet they still hit 180s beforeAll timeouts --
// because a SIBLING worktree runs its own gate concurrently. No per-run knob can
// observe another process, so the control must live at the host level.
//
// Two pure helpers, both unit-testable with zero I/O:
//   evaluateHostReadiness - decide whether it is safe to start a heavy gate,
//     naming the competing worktree when one is detected.
//   buildFlockArgs - build the flock(1) argv that serializes gates across
//     worktrees (kernel releases the lock on process death, so it is crash-safe).
import { describe, it, expect } from 'vitest';
import {
  evaluateHostReadiness,
  buildFlockArgs,
  resolveGateLockPath,
  MIN_DISK_GIB,
  type HostSnapshot,
} from './host-gate.js';

const healthy: HostSnapshot = {
  load1: 2,
  cores: 8,
  availableGiB: 6,
  availableDiskGiB: 120,
  testContainerNames: [],
  ownContainerName: 'fleet-pg-test-50d50c60da41',
};

describe('evaluateHostReadiness', () => {
  it('is ready on an idle host with no test containers', () => {
    const r = evaluateHostReadiness(healthy);
    expect(r.ready).toBe(true);
    expect(r.problems).toEqual([]);
  });
  it('is ready when the only test container is our OWN worktree', () => {
    const r = evaluateHostReadiness({
      ...healthy,
      testContainerNames: ['fleet-pg-test-50d50c60da41'],
    });
    expect(r.ready).toBe(true);
  });
  it('BLOCKS when a FOREIGN worktree container is running, naming it', () => {
    const r = evaluateHostReadiness({
      ...healthy,
      testContainerNames: ['fleet-pg-test-12f2574406eb'],
    });
    expect(r.ready).toBe(false);
    expect(r.problems.join(' ')).toContain('fleet-pg-test-12f2574406eb');
  });
  it('BLOCKS when load per core exceeds the ceiling', () => {
    const r = evaluateHostReadiness({ ...healthy, load1: 19.27, cores: 8 });
    expect(r.ready).toBe(false);
    expect(r.problems.join(' ')).toContain('load');
  });
  it('BLOCKS when available memory is below the floor', () => {
    const r = evaluateHostReadiness({ ...healthy, availableGiB: 0.4 });
    expect(r.ready).toBe(false);
    expect(r.problems.join(' ')).toContain('GiB');
  });
  // Spreads `healthy` like every sibling case (2026-08-08). This was the one
  // test that hand-built a full snapshot literal, so when availableDiskGiB was
  // added to HostSnapshot it went stale here and nowhere else -- TS2345, the
  // same drift class as the close-worktree fixtures. Overriding only the three
  // axes under test also keeps the assertion honest: healthy's 120GiB disk is
  // deliberately NOT a fourth problem, which is exactly the distinction the
  // 'names disk alongside every other problem' case below draws by setting disk
  // to 0.2 and expecting 4.
  it('reports EVERY problem at once, not just the first', () => {
    const r = evaluateHostReadiness({
      ...healthy,
      load1: 19.27,
      cores: 8,
      availableGiB: 0.3,
      testContainerNames: ['fleet-pg-test-12f2574406eb'],
    });
    expect(r.ready).toBe(false);
    expect(r.problems).toHaveLength(3);
  });
  it('ignores non-test containers entirely', () => {
    const r = evaluateHostReadiness({
      ...healthy,
      testContainerNames: [],
    });
    expect(r.ready).toBe(true);
  });
  it('treats an unknown own-container as foreign-safe (never a false OK)', () => {
    const r = evaluateHostReadiness({
      ...healthy,
      ownContainerName: null,
      testContainerNames: ['fleet-pg-test-anything'],
    });
    expect(r.ready).toBe(false);
  });

  // Disk was the ONE saturation axis this guard did not measure, and it is the
  // axis that actually took the host down on 2026-07-27: free space hit zero,
  // the Docker Desktop VM lost its backing disk, and every docker invocation
  // began failing with an exec-layer Input/output error. Eighteen e2e specs
  // reported as product failures for a full suite run before the cause was
  // visible. Load and memory were both healthy throughout, so no existing
  // predicate could have caught it.
  it('BLOCKS when free disk is below the floor', () => {
    const r = evaluateHostReadiness({ ...healthy, availableDiskGiB: 0.5 });
    expect(r.ready).toBe(false);
    expect(r.problems.join(' ')).toContain('disk');
  });

  it('is ready when free disk sits exactly at the floor', () => {
    const r = evaluateHostReadiness({ ...healthy, availableDiskGiB: MIN_DISK_GIB });
    expect(r.ready).toBe(true);
  });

  // Fail-safe, matching how availableGiB already behaves: a host we cannot
  // measure must never be blocked, because an unmeasurable axis is not a
  // saturated one.
  it('treats an unmeasurable disk as OK rather than blocking', () => {
    const r = evaluateHostReadiness({ ...healthy, availableDiskGiB: Number.POSITIVE_INFINITY });
    expect(r.ready).toBe(true);
  });

  // A JS statfs binding truncates f_bavail to 32 bits, so a filesystem with
  // more than ~17.6TB free reports a NEGATIVE figure. Read naively that is the
  // fullest possible disk, and the guard would block every run on the roomiest
  // hosts. Nonsensical means unknown, never full.
  it('treats a NEGATIVE disk figure as unknown, not as full', () => {
    const r = evaluateHostReadiness({ ...healthy, availableDiskGiB: -4469.49 });
    expect(r.ready).toBe(true);
  });

  it('treats NaN disk as unknown, not as full', () => {
    const r = evaluateHostReadiness({ ...healthy, availableDiskGiB: Number.NaN });
    expect(r.ready).toBe(true);
  });

  it('names disk alongside every other problem at once', () => {
    const r = evaluateHostReadiness({
      load1: 19.27,
      cores: 8,
      availableGiB: 0.3,
      availableDiskGiB: 0.2,
      testContainerNames: ['fleet-pg-test-12f2574406eb'],
      ownContainerName: 'fleet-pg-test-50d50c60da41',
    });
    expect(r.ready).toBe(false);
    expect(r.problems).toHaveLength(4);
  });
});

describe('buildFlockArgs', () => {
  it('builds a waiting, self-releasing flock invocation around the command', () => {
    const args = buildFlockArgs('/tmp/fleet-gate.lock', 3600, ['pnpm', 'exec', 'turbo', 'run']);
    // util-linux flock(1) file-then-command mode takes the command DIRECTLY
    // after the lock path. A literal '--' separator is not supported there and
    // is itself executed: 'flock: failed to execute --: No such file or directory'.
    expect(args).toEqual(['-w', '3600', '/tmp/fleet-gate.lock', 'pnpm', 'exec', 'turbo', 'run']);
    expect(args).not.toContain('--');
  });
  it('rejects an empty command rather than locking around nothing', () => {
    expect(() => buildFlockArgs('/tmp/x.lock', 60, [])).toThrow();
  });
  it('rejects a non-positive wait budget (a gate must never hang forever)', () => {
    expect(() => buildFlockArgs('/tmp/x.lock', 0, ['echo'])).toThrow();
  });
});

describe('resolveGateLockPath', () => {
  // flock(1) is ADVISORY and inode-scoped: mutual exclusion holds only when
  // every cooperating process locks the SAME file. The pre-push coverage hook
  // has locked $HOME/.cache/fleetmanagement/gate.lock since 9710dd8, while
  // fab24dd later gave gate:integration its own /tmp path -- so the two gates
  // never excluded each other and a sibling worktree still starved this one.
  // One exported resolver removes the possibility of that drift recurring.
  it('resolves under XDG_CACHE_HOME when set', () => {
    expect(resolveGateLockPath({ XDG_CACHE_HOME: '/xdg' }, '/home/u')).toBe(
      '/xdg/fleetmanagement/gate.lock',
    );
  });
  it('falls back to HOME/.cache when XDG_CACHE_HOME is unset', () => {
    expect(resolveGateLockPath({}, '/home/u')).toBe('/home/u/.cache/fleetmanagement/gate.lock');
  });
  it('ignores a non-absolute XDG_CACHE_HOME per the XDG spec', () => {
    expect(resolveGateLockPath({ XDG_CACHE_HOME: 'relative/path' }, '/home/u')).toBe(
      '/home/u/.cache/fleetmanagement/gate.lock',
    );
  });
  it('never returns a world-writable /tmp path (tmpfiles can sweep the inode)', () => {
    expect(resolveGateLockPath({}, '/home/u')).not.toContain('/tmp/');
  });
  it('matches the path the pre-push hook already locks', () => {
    expect(resolveGateLockPath({}, '/home/lenovo')).toBe(
      '/home/lenovo/.cache/fleetmanagement/gate.lock',
    );
  });
});
