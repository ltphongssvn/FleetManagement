// scripts/gate-coverage-lock.ts
// PURE CORE for the coverage gate's cross-worktree lock, plus the spawn-failure
// diagnostic. No I/O here: the driver in gate-coverage.ts performs the mkdir.
//
// ROOT CAUSE 1 -- PORTABILITY. The gate spawned flock(1) unconditionally. flock
// is util-linux and does not exist on macOS, so on all three Macs in this estate
// spawnSync failed ENOENT, the child never ran, and the log file stayed 0 bytes.
// The gate then printed a coverage-FAILED banner with NOTHING under it, because
// a status coalesce collapses "never ran" into "exited non-zero". Every push
// from every Mac was blocked by what looked like a red suite.
//
// ROOT CAUSE 2 -- ORPHANED LOCKS. Observed 2026-08-15 on the first real run:
// the child died with status 130 (128+SIGINT, the exit code Node documents for
// its default signal handlers) and the lock directory was left behind, blocking
// the estate. A time-based staleness threshold cannot fix this honestly: mkdir
// stamps mtime ONCE, proper-lockfile answers that with a heartbeat, and a
// heartbeat is impossible while spawnSync blocks the event loop. Any threshold
// is therefore a guess, and the first one had to be overridden by hand within
// the hour.
//
// LIVENESS IS THE ANSWER, NOT AGE. The lock records the OWNING PID, and a
// holder is alive if signal 0 reaches it -- the POSIX liveness probe, which
// throws ESRCH when the process is gone. That is DIRECT EVIDENCE rather than a
// timer, so a crashed holder is reclaimed on the next attempt instead of hours
// later. Age is kept ONLY as a fallback for a lock written by another machine,
// where a local PID means nothing.
//
// mkdir remains the mutual-exclusion primitive: atomic on every filesystem
// including network ones, which is why proper-lockfile chose it over O_EXCL,
// documented as racy on NFS. No dependency is added.

/** Total time to wait for the lock before giving up. Contention is a queue, not
 *  an error: six worktree terminals share one host. */
export const LOCK_WAIT_MS = 7200 * 1000;

/** Poll interval while queued. Long enough not to spin a core, short enough
 *  that a freed lock is picked up promptly. */
export const LOCK_POLL_MS = 1000;

/** Age past which a lock from ANOTHER HOST is presumed abandoned. Only reached
 *  when PID liveness cannot be evaluated, so it is a fallback and not the
 *  primary mechanism. */
export const FOREIGN_LOCK_STALE_MS = 4 * 3600 * 1000;

/** The lock directory. A DIRECTORY, not a file: mkdir fails with EEXIST
 *  atomically, which is the whole mutual-exclusion primitive. Sits beside the
 *  log under the cache dir so every worktree contends for the SAME path -- a
 *  repo-relative lock would serialize nothing, since worktrees differ by path. */
export function lockDirPath(cacheDir: string): string {
  return cacheDir + '/gate-coverage.lock.d';
}

/** Owner record inside the lock. Written at acquire, read by a contender. */
export function lockOwnerPath(lockDir: string): string {
  return lockDir + '/owner.json';
}

export interface LockOwner {
  readonly pid: number;
  readonly host: string;
  readonly startedAt: number;
}

/** PURE. Serialize the owner record. Deterministic key order so the file diffs
 *  predictably when an operator inspects a stuck lock by hand. */
export function renderOwner(owner: LockOwner): string {
  return JSON.stringify({ pid: owner.pid, host: owner.host, startedAt: owner.startedAt });
}

/** PURE. Parse an owner record, FAIL-CLOSED. An unreadable or malformed record
 *  yields null, and null is treated as "cannot prove dead" by the caller -- a
 *  broken read must never license stealing a live lock. */
export function parseOwner(text: string): LockOwner | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return null;
    const rec = raw as Record<string, unknown>;
    const pid = rec['pid'];
    const host = rec['host'];
    const startedAt = rec['startedAt'];
    if (typeof pid !== 'number' || typeof host !== 'string' || typeof startedAt !== 'number') {
      return null;
    }
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, host, startedAt };
  } catch {
    return null;
  }
}

export interface ReclaimInput {
  /** null when the record is missing or malformed. */
  readonly owner: LockOwner | null;
  /** This machine's hostname, for deciding whether the PID is meaningful. */
  readonly thisHost: string;
  /** null when liveness could not be probed (foreign host, or probe error). */
  readonly ownerAlive: boolean | null;
  readonly ageMs: number;
}

/** PURE. Decide whether an existing lock may be reclaimed.
 *
 *  FAIL-CLOSED by construction: reclaim requires POSITIVE evidence the holder
 *  is gone. Not-knowing is never evidence, because stealing a live lock lets
 *  two coverage suites run concurrently on one host -- the starvation this lock
 *  exists to prevent, now with a corrupted result. */
export function decideReclaim(input: ReclaimInput): boolean {
  // A malformed or missing owner record cannot prove liveness either way, so
  // only age may reclaim it. This also covers locks written by an older build
  // that recorded no owner at all.
  if (input.owner === null) return input.ageMs > FOREIGN_LOCK_STALE_MS;

  // Same host: the PID is meaningful, so liveness is DIRECT evidence and
  // outranks any clock.
  if (input.owner.host === input.thisHost && input.ownerAlive !== null) {
    return !input.ownerAlive;
  }

  // Another host (a shared network cache dir): a local PID says nothing about a
  // remote process, so fall back to age.
  return input.ageMs > FOREIGN_LOCK_STALE_MS;
}

export interface LockAttempt {
  readonly acquired: boolean;
  readonly elapsedMs: number;
}

export type LockDecision =
  | { readonly outcome: 'acquired' }
  | { readonly outcome: 'retry' }
  | { readonly outcome: 'timeout' };

/** PURE. Order matters: an ACQUIRED lock wins even past the deadline, because
 *  discarding a lock we already hold would both waste the wait and leave a
 *  directory behind that nobody releases. */
export function decideLockAttempt(attempt: LockAttempt): LockDecision {
  if (attempt.acquired) return { outcome: 'acquired' };
  if (attempt.elapsedMs > LOCK_WAIT_MS) return { outcome: 'timeout' };
  return { outcome: 'retry' };
}

export interface SpawnErrorLike {
  readonly code?: string;
  readonly message?: string;
}

/** PURE. Distinguishes "the command never ran" from "the command failed".
 *
 *  This is the diagnostic that was missing. spawnSync sets .error and leaves
 *  .status null when the binary is absent; folding that into an exit status
 *  made an ENOENT read exactly like a failing test suite -- with an empty log,
 *  because nothing was ever written to the fd. Returns null when the process
 *  actually ran, so genuine failures still replay the log. */
export function spawnFailureMessage(
  command: string,
  error: SpawnErrorLike | undefined,
): string | null {
  if (error === undefined) return null;
  const code = error.code ?? 'unknown';
  const detail = error.message ?? '';
  return (
    'the command never ran: ' +
    command +
    ' could not be spawned (' +
    code +
    ').' +
    (detail.length > 0 ? ' ' + detail : '') +
    ' The log is empty because no output was produced. This is a HOST problem, not a test failure.'
  );
}

/** Signals that must release the lock before the process dies. SIGKILL is
 *  absent because it cannot be caught -- that case is what PID liveness covers. */
export const CLEANUP_SIGNALS: readonly string[] = Object.freeze([
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGQUIT',
]);

/** PURE. Exit code for a run ended by a signal. POSIX convention, and the same
 *  value Node's own default handlers use, so a wrapper sees the familiar 130
 *  for SIGINT rather than an invented code. */
export function signalExitCode(signalNumber: number): number {
  return 128 + signalNumber;
}
