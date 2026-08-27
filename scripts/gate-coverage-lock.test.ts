// scripts/gate-coverage-lock.test.ts
// RED (t122, 2026-08-15): the coverage gate must hold its cross-worktree lock
// WITHOUT shelling out to flock, and must never strand the estate behind a lock
// whose owner is dead.
//
// TWO FAILURES DRIVE THIS FILE, both observed on this machine today.
//
// 1. flock(1) is util-linux and absent on macOS, so spawnSync failed ENOENT,
//    the child never ran, the log stayed 0 bytes, and the gate printed a
//    coverage-FAILED banner with nothing under it -- a missing binary wearing
//    the costume of a red test suite. Every push from every Mac was blocked.
//
// 2. The first real run died with status 130 (128+SIGINT) and LEFT THE LOCK
//    BEHIND. The initial design reclaimed by AGE, which cannot be honest here:
//    mkdir stamps mtime once, proper-lockfile answers that with a heartbeat,
//    and a heartbeat cannot run while spawnSync blocks the event loop. The
//    threshold had to be overridden by hand within the hour, which is the
//    definition of a treadmill.
//
// So liveness replaces age: the lock records its owner PID, and signal 0 is the
// POSIX probe for whether that process still exists. Direct evidence outranks a
// clock. Age survives only as a fallback for a lock written by another host,
// where a local PID is meaningless.
import { describe, it, expect } from 'vitest';
import {
  CLEANUP_SIGNALS,
  FOREIGN_LOCK_STALE_MS,
  LOCK_POLL_MS,
  LOCK_WAIT_MS,
  decideLockAttempt,
  decideReclaim,
  lockDirPath,
  lockOwnerPath,
  parseOwner,
  renderOwner,
  signalExitCode,
  spawnFailureMessage,
} from './gate-coverage-lock.js';

const HOST = 'mac-3';

describe('the lock is a directory, not an external binary', () => {
  it('lives beside the log under the cache dir, never repo-relative', () => {
    const p = lockDirPath('/home/u/.cache/fleetmanagement');
    expect(p.startsWith('/home/u/.cache/fleetmanagement')).toBe(true);
    expect(p.includes('/code/')).toBe(false);
  });

  it('is a stable path so every worktree contends for the SAME lock', () => {
    expect(lockDirPath('/home/u/.cache/fleetmanagement')).toBe(
      lockDirPath('/home/u/.cache/fleetmanagement'),
    );
  });

  it('keeps the owner record inside the lock, so it disappears with it', () => {
    const dir = lockDirPath('/c');
    expect(lockOwnerPath(dir).startsWith(dir)).toBe(true);
  });
});

describe('contention is a queue, not an error', () => {
  it('waits at least an hour, matching the flock design it replaces', () => {
    expect(LOCK_WAIT_MS).toBeGreaterThanOrEqual(3600 * 1000);
  });

  it('polls often enough to be responsive but not to spin', () => {
    expect(LOCK_POLL_MS).toBeGreaterThanOrEqual(100);
    expect(LOCK_POLL_MS).toBeLessThanOrEqual(5000);
  });

  it('retries while the deadline is in the future', () => {
    expect(decideLockAttempt({ acquired: false, elapsedMs: 0 })).toEqual({ outcome: 'retry' });
  });

  it('proceeds the moment the lock is taken', () => {
    expect(decideLockAttempt({ acquired: true, elapsedMs: 0 })).toEqual({ outcome: 'acquired' });
  });

  it('gives up ONLY after the full wait, and says so rather than running unlocked', () => {
    expect(decideLockAttempt({ acquired: false, elapsedMs: LOCK_WAIT_MS + 1 })).toEqual({
      outcome: 'timeout',
    });
  });

  it('an acquired lock beats an expired deadline -- never discard a win', () => {
    expect(decideLockAttempt({ acquired: true, elapsedMs: LOCK_WAIT_MS + 1 })).toEqual({
      outcome: 'acquired',
    });
  });
});

describe('the owner record round-trips and refuses garbage', () => {
  it('survives render then parse unchanged', () => {
    const owner = { pid: 4321, host: HOST, startedAt: 1_700_000_000_000 };
    expect(parseOwner(renderOwner(owner))).toEqual(owner);
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseOwner('{not json')).toBeNull();
  });

  it('rejects a record missing its pid', () => {
    expect(parseOwner(JSON.stringify({ host: HOST, startedAt: 1 }))).toBeNull();
  });

  it('rejects a nonsense pid, which could otherwise probe an unrelated process', () => {
    expect(parseOwner(JSON.stringify({ pid: 0, host: HOST, startedAt: 1 }))).toBeNull();
    expect(parseOwner(JSON.stringify({ pid: -7, host: HOST, startedAt: 1 }))).toBeNull();
    expect(parseOwner(JSON.stringify({ pid: 1.5, host: HOST, startedAt: 1 }))).toBeNull();
  });
});

describe('reclaim demands POSITIVE evidence the holder is gone', () => {
  it('reclaims a same-host lock whose owner process no longer exists', () => {
    expect(
      decideReclaim({
        owner: { pid: 999, host: HOST, startedAt: 0 },
        thisHost: HOST,
        ownerAlive: false,
        ageMs: 0,
      }),
      'a dead owner is direct evidence, so the estate is freed on the next attempt',
    ).toBe(true);
  });

  it('NEVER steals a lock from a live owner, however old it is', () => {
    expect(
      decideReclaim({
        owner: { pid: 999, host: HOST, startedAt: 0 },
        thisHost: HOST,
        ownerAlive: true,
        ageMs: FOREIGN_LOCK_STALE_MS * 10,
      }),
      'a long coverage run is not a dead one; stealing here runs two suites at once',
    ).toBe(false);
  });

  it('refuses to reclaim when liveness could not be probed', () => {
    expect(
      decideReclaim({
        owner: { pid: 999, host: HOST, startedAt: 0 },
        thisHost: HOST,
        ownerAlive: null,
        ageMs: 0,
      }),
      'not knowing is not evidence -- a broken probe must not license a steal',
    ).toBe(false);
  });

  it('falls back to age for a lock written by ANOTHER host', () => {
    const foreign = { owner: { pid: 999, host: 'other-box', startedAt: 0 }, thisHost: HOST };
    expect(decideReclaim({ ...foreign, ownerAlive: null, ageMs: 0 })).toBe(false);
    expect(decideReclaim({ ...foreign, ownerAlive: null, ageMs: FOREIGN_LOCK_STALE_MS + 1 })).toBe(
      true,
    );
  });

  it('ignores a foreign PID even when it happens to match a live local process', () => {
    expect(
      decideReclaim({
        owner: { pid: 999, host: 'other-box', startedAt: 0 },
        thisHost: HOST,
        ownerAlive: true,
        ageMs: FOREIGN_LOCK_STALE_MS + 1,
      }),
      'a PID from another machine says nothing about this one',
    ).toBe(true);
  });

  it('reclaims an ownerless lock only by age, covering locks from an older build', () => {
    expect(decideReclaim({ owner: null, thisHost: HOST, ownerAlive: null, ageMs: 0 })).toBe(false);
    expect(
      decideReclaim({
        owner: null,
        thisHost: HOST,
        ownerAlive: null,
        ageMs: FOREIGN_LOCK_STALE_MS + 1,
      }),
    ).toBe(true);
  });
});

describe('a signal must release the lock, not strand it', () => {
  it('covers every catchable termination signal', () => {
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(CLEANUP_SIGNALS).toContain(s);
    }
  });

  it('does NOT list SIGKILL, which cannot be caught', () => {
    expect(
      CLEANUP_SIGNALS.includes('SIGKILL'),
      'pretending to handle SIGKILL would be a lie; PID liveness covers that case',
    ).toBe(false);
  });

  it('reports the POSIX 128+n exit code, so SIGINT still reads as 130', () => {
    expect(signalExitCode(2)).toBe(130);
    expect(signalExitCode(15)).toBe(143);
  });
});

describe('a spawn that never ran is not a test failure', () => {
  it('names the missing binary rather than reporting an empty coverage failure', () => {
    const m = spawnFailureMessage('pnpm', { code: 'ENOENT', message: 'spawnSync pnpm ENOENT' });
    expect(m).toContain('pnpm');
    expect(m).toContain('ENOENT');
  });

  it('says the command never ran, so the empty log is explained', () => {
    expect(spawnFailureMessage('pnpm', { code: 'ENOENT' })?.toLowerCase()).toContain('never ran');
  });

  it('is null when the process actually ran, so normal failures replay the log', () => {
    expect(spawnFailureMessage('pnpm', undefined)).toBeNull();
  });
});
