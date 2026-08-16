// scripts/gate-coverage.ts
// The pre-push coverage gate as a committed, tested op.
//
// WHY THIS EXISTS. The pre-push hook died three times on 2026-08-05 with
//   BlockingIOError: [Errno 11] write could not complete without blocking
// while the tests it ran were PASSING. The cause is output VOLUME: every
// workspace's vitest run crossed pre-commit's captured pipe, the pipe filled,
// and a write to a non-blocking fd returned EAGAIN. The remedy in every
// reported case is to reduce what crosses the pipe.
//
// WHY A LOG FILE RATHER THAN A QUIET REPORTER. The first attempt appended
// --reporter=dot through recursive pnpm. The flag never reached vitest, because
// these test:coverage scripts are compound shell strings and recursive pnpm
// does not forward trailing args into them. Redirecting to a file removes the
// traffic entirely and needs no cooperation from those scripts.
//
// FAILURES LOSE NOTHING. On a non-zero exit the log is replayed in full. A gate
// that hides its reason is worse than a noisy one; this one is silent only when
// there is nothing to say.
//
// THE LOCK IS NO LONGER flock (t122). flock(1) is util-linux and does not exist
// on macOS, so this gate had NEVER run on any Mac in the estate: spawnSync
// failed ENOENT, the child never started, the log stayed 0 bytes, and a status
// coalesce collapsed never-ran into exited-non-zero. Every push from every Mac
// was blocked by what looked like a red suite and was a missing binary.
//
// AND IT RELEASES ON SIGNALS (t122, same day, second defect). The first real
// run died with status 130 -- 128+SIGINT, the code Node documents for its own
// default handlers -- and left the lock directory behind, blocking the estate
// until it was removed by hand. Node's docs also name the trap in fixing this:
// installing a listener REMOVES the default exit behaviour, so a handler that
// forgets to exit turns a clean kill into a genuine hang. Cleanup therefore
// re-raises the signal after releasing.
//
// PROGRESS IS PRINTED. Thirty minutes of a blank terminal is indistinguishable
// from a hang, which is exactly how the orphaned lock was found. A heartbeat
// line proves the run is alive without putting test output back on the pipe.
/** The recursive coverage run. --workspace-concurrency=1 keeps PGlite WASM
 *  cold-starts inside the hook budget (observed 1018s import phase under
 *  contention vs ~28s isolated). No reporter flag: it provably does not reach
 *  vitest through a compound script, and pretending otherwise is what made the
 *  previous fix ineffective. */
export function coverageArgs(): readonly string[] {
  return ['-r', '--workspace-concurrency=1', '--if-present', 'test:coverage'];
}
/** The 90/90/90/90 merge, unchanged: the same script CI runs across its shards,
 *  pointed at the single coverage-final.json apps/api emits locally. */
export function mergeArgs(): readonly string[] {
  return ['scripts/merge-coverage.mjs', 'apps/api/coverage/merged'];
}
/** Where the run's output goes instead of the pipe. Under HOME beside the lock,
 *  never in the repo tree: it must not appear in git status or be swept by a
 *  clean. */
export function gateLogPath(cacheDir: string): string {
  return cacheDir + '/gate-coverage.log';
}
// A bash and-and/or-echo chain once swallowed a real failure into exit 0 and
// pushed a broken commit to CI. The vocabulary is explicit so that cannot recur.
// host is DISTINCT from coverage deliberately: a binary that never ran is not a
// failing test, and conflating them is the defect t122 removes.
export const GATE_COVERAGE_EXIT = {
  ok: 0,
  coverage: 1,
  merge: 3,
  host: 4,
} as const;
export interface GateStepResults {
  coverage: number;
  merge: number;
}
/** Coverage failure wins when both fail: it is the earlier cause, and a merge
 *  error downstream of a failed run says nothing the operator can act on. */
export function gateExitCode(r: GateStepResults): number {
  if (r.coverage !== 0) return GATE_COVERAGE_EXIT.coverage;
  if (r.merge !== 0) return GATE_COVERAGE_EXIT.merge;
  return GATE_COVERAGE_EXIT.ok;
}
/* v8 ignore start -- side-effecting driver; the planners above are unit-tested */
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { LockOwner } from './gate-coverage-lock.js';
import {
  CLEANUP_SIGNALS,
  LOCK_POLL_MS,
  decideLockAttempt,
  decideReclaim,
  lockDirPath,
  lockOwnerPath,
  parseOwner,
  renderOwner,
  signalExitCode,
  spawnFailureMessage,
} from './gate-coverage-lock.js';
const NL = String.fromCharCode(10);
function say(message: string): void {
  process.stderr.write('[gate:coverage] ' + message + NL);
}
function replay(logPath: string, label: string): void {
  process.stderr.write(NL + '=== ' + label + ' ===' + NL);
  try {
    process.stderr.write(readFileSync(logPath, 'utf8'));
  } catch {
    process.stderr.write('(log unreadable at ' + logPath + ')' + NL);
  }
}
/** Synchronous sleep. The driver is synchronous because spawnSync is, so a
 *  timer-based wait would never fire. Atomics.wait blocks without spinning a
 *  core, which a busy loop on Date.now would. */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/** POSIX liveness probe. Signal 0 performs the permission and existence checks
 *  WITHOUT delivering a signal, throwing ESRCH when the process is gone. Null
 *  means the question could not be answered, which callers treat as "cannot
 *  prove dead" rather than as permission to steal the lock. */
function processAlive(pid: number): boolean | null {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return null;
  }
}
function readOwner(lockDir: string): LockOwner | null {
  try {
    return parseOwner(readFileSync(lockOwnerPath(lockDir), 'utf8'));
  } catch {
    return null;
  }
}
function lockAgeMs(lockDir: string): number {
  try {
    return Date.now() - statSync(lockDir).mtimeMs;
  } catch {
    return 0;
  }
}
/** One attempt. mkdir IS the mutual exclusion: it fails with EEXIST atomically,
 *  so exactly one contender wins, and it works on network filesystems where
 *  O_EXCL is documented to race. The owner record is written immediately after,
 *  so a contender can evaluate liveness rather than guess from a clock. */
function tryAcquire(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
  } catch {
    return false;
  }
  writeFileSync(
    lockOwnerPath(lockDir),
    renderOwner({ pid: process.pid, host: hostname(), startedAt: Date.now() }),
  );
  return true;
}
function releaseLock(lockDir: string): void {
  rmSync(lockDir, { recursive: true, force: true });
}
/** Blocks until the lock is held, or gives up after the full wait. NEVER
 *  proceeds unlocked: six concurrent coverage suites on one host is the
 *  starvation this queue exists to prevent. */
function acquireLock(lockDir: string): boolean {
  const startedAt = Date.now();
  let announced = false;
  for (;;) {
    const decision = decideLockAttempt({
      acquired: tryAcquire(lockDir),
      elapsedMs: Date.now() - startedAt,
    });
    if (decision.outcome === 'acquired') return true;
    if (decision.outcome === 'timeout') return false;
    const owner = readOwner(lockDir);
    if (
      decideReclaim({
        owner,
        thisHost: hostname(),
        ownerAlive: owner === null ? null : processAlive(owner.pid),
        ageMs: lockAgeMs(lockDir),
      })
    ) {
      say('reclaiming a lock whose owner is gone');
      releaseLock(lockDir);
      continue;
    }
    if (!announced) {
      announced = true;
      say('waiting for the gate lock held by another worktree (queueing, not failing)');
    }
    sleepMs(LOCK_POLL_MS);
  }
}
interface RunResult {
  readonly status: number;
  readonly hostError: string | null;
}
/** Runs a child with both streams on the log fd. A spawn error becomes a HOST
 *  problem rather than an exit status -- the distinction whose absence hid the
 *  missing flock binary for this script's entire life on macOS. */
function run(command: string, args: readonly string[], fd: number): RunResult {
  const r = spawnSync(command, [...args], { stdio: ['ignore', fd, fd] });
  const hostError = spawnFailureMessage(command, r.error);
  if (hostError !== null) return { status: GATE_COVERAGE_EXIT.host, hostError };
  // status is null ONLY when the child was killed by a signal, which must read
  // as failure. It is never null for a spawn that failed -- that case returned
  // above -- so this can no longer disguise an absent binary.
  return { status: r.status ?? 1, hostError: null };
}
/** Release on every catchable termination signal, then RE-RAISE.
 *
 *  Node documents that installing a listener removes the default exit
 *  behaviour, so omitting the re-raise would convert Ctrl-C into a real hang --
 *  the opposite of the bug being fixed. Re-raising also preserves the
 *  conventional 128+n exit code a wrapper expects. */
function installCleanup(lockDir: string): void {
  const numbers: Readonly<Record<string, number>> = { SIGINT: 2, SIGQUIT: 3, SIGTERM: 15, SIGHUP: 1 };
  for (const signal of CLEANUP_SIGNALS) {
    process.on(signal as NodeJS.Signals, () => {
      releaseLock(lockDir);
      say('released the lock on ' + signal);
      process.exit(signalExitCode(numbers[signal] ?? 15));
    });
  }
}
function main(): number {
  const cacheDir = join(homedir(), '.cache', 'fleetmanagement');
  mkdirSync(cacheDir, { recursive: true });
  const lockDir = lockDirPath(cacheDir);
  const logPath = gateLogPath(cacheDir);
  if (!acquireLock(lockDir)) {
    say('FAILED -- timed out waiting for the gate lock held by another worktree');
    return GATE_COVERAGE_EXIT.host;
  }
  installCleanup(lockDir);
  // Both streams go to the FILE, not to pre-commit's pipe. That is the original
  // fix: the bytes never traverse the descriptor that was overflowing.
  const fd = openSync(logPath, 'w');
  const startedAt = Date.now();
  let coverage: RunResult;
  let merge: RunResult = { status: 0, hostError: null };
  try {
    say('running 13 workspaces; this takes many minutes (output -> ' + logPath + ')');
    say('tail that file in another terminal to watch progress');
    coverage = run('pnpm', coverageArgs(), fd);
    if (coverage.hostError === null && coverage.status === 0) {
      merge = run('node', mergeArgs(), fd);
    }
  } finally {
    // Released in finally so a throw cannot strand the estate behind a lock
    // that nothing will ever clear. Signals are covered by installCleanup.
    closeSync(fd);
    releaseLock(lockDir);
  }
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  if (coverage.hostError !== null) {
    say('FAILED -- ' + coverage.hostError);
    return GATE_COVERAGE_EXIT.host;
  }
  if (merge.hostError !== null) {
    say('FAILED -- ' + merge.hostError);
    return GATE_COVERAGE_EXIT.host;
  }
  if (coverage.status !== 0) {
    replay(logPath, 'coverage FAILED after ' + String(elapsed) + 's -- full output');
    return gateExitCode({ coverage: coverage.status, merge: 0 });
  }
  if (merge.status !== 0) {
    replay(logPath, '90/90/90/90 merge gate FAILED -- full output');
    return gateExitCode({ coverage: 0, merge: merge.status });
  }
  say('passed in ' + String(elapsed) + 's');
  return GATE_COVERAGE_EXIT.ok;
}
const isMain = process.argv[1]?.endsWith('gate-coverage.ts') ?? false;
if (isMain) {
  process.exit(main());
}
/* v8 ignore stop */
