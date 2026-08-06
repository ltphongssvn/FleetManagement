// scripts/gate-coverage.ts
// The pre-push coverage gate as a committed, tested op.
//
// WHY THIS EXISTS. The pre-push hook died three times on 2026-08-05 with
//   BlockingIOError: [Errno 11] write could not complete without blocking
// while the tests it ran were PASSING. The cause is output VOLUME: every
// workspace's vitest run crossed pre-commit's captured pipe, the pipe filled,
// and a write() to a non-blocking fd returned EAGAIN. The same failure is
// reported against doit, uwsgi, pytest and Cloud Run, and the remedy in every
// case is to reduce what crosses the pipe.
//
// WHY A LOG FILE RATHER THAN A QUIET REPORTER. The first attempt appended
// --reporter=dot through `pnpm -r ... --`. It did not work: the flag never
// reached vitest, because these test:coverage scripts are compound shell
// strings (rm -rf && VITEST_ENFORCE_THRESHOLDS=1 vitest run --config ...) and
// recursive pnpm does not forward trailing args into them. Setting reporters
// per package was the alternative, but vitest rejects `reporters` in a project
// config, so it would mean editing thirteen configs plus a shared base -- a
// large change to fix a pipe. Redirecting to a file removes the traffic
// entirely and is strictly better than dot, which still streams a character
// per test plus per-file summaries.
//
// FAILURES LOSE NOTHING. On a non-zero exit the log is replayed in full, so
// the operator sees more than the old streaming gate showed, not less. A gate
// that hides its reason is worse than a noisy one; this one is silent only
// when there is nothing to say.
const LOCK_WAIT_SECONDS = 7200;
/** flock argv. The lock lives under HOME, never repo-relative: this box runs up
 *  to six worktree terminals and a repo-local lock serializes nothing. -w waits
 *  rather than failing, because contention is a queue, not an error. */
export function lockArgs(lockPath: string): readonly string[] {
  return ['-w', String(LOCK_WAIT_SECONDS), lockPath];
}
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
// A bash `cmd1 && cmd2 || echo` once swallowed a real failure into exit 0 and
// pushed a broken commit to CI. The vocabulary is explicit so that cannot recur.
export const GATE_COVERAGE_EXIT = {
  ok: 0,
  coverage: 1,
  merge: 3,
  runtime: 4,
} as const;
/** Whether this sweep needs a container runtime at all.
 *
 *  apps/api test:coverage starts a Postgres testcontainer, so the answer is
 *  yes for the recursive gate. It is a function rather than a constant because
 *  the fact belongs to the sweep's composition, not to this module. */
export function needsContainerRuntime(): boolean {
  return true;
}
/** The probe. `info` answers only when the daemon is reachable and costs no
 *  image pull, no container and no network -- `run` would pay part of the very
 *  cost the probe exists to avoid. */
export function containerRuntimeProbeArgs(): readonly string[] {
  return ['docker', 'info'];
}
/** Actionable guidance, not a stack trace.
 *
 *  With Docker Desktop down the gate previously ran eleven workspaces to
 *  completion -- about four minutes and some 2500 passing tests -- then died at
 *  the twelfth with `spawnSync docker EIO` followed by ~200 lines of 0%
 *  threshold errors naming every file in apps/api and none of the cause.
 *
 *  The remedy names PowerShell deliberately: WSL interop is disabled on this
 *  host, so `docker desktop start` is not reachable from the shell running this
 *  gate, and advice that omits that sends the operator in a circle. */
export function containerRuntimeUnavailableMessage(): string {
  return [
    '[gate:coverage] no container runtime -- stopping before the sweep.',
    '',
    'apps/api test:coverage starts a Postgres container via Testcontainers,',
    'so the recursive run cannot pass without a reachable Docker daemon.',
    '',
    'Remedy (WSL interop is disabled here, so run this from PowerShell):',
    '  docker desktop start; Start-Sleep -Seconds 45; docker desktop status',
    '',
    'Then re-run the push. Nothing was skipped for any other reason: the',
    'eleven non-api workspaces were not started rather than left broken.',
  ].join(String.fromCharCode(10));
}
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
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const NL = String.fromCharCode(10);
function replay(logPath: string, label: string): void {
  process.stderr.write(NL + '=== ' + label + ' ===' + NL);
  try {
    process.stderr.write(readFileSync(logPath, 'utf8'));
  } catch {
    process.stderr.write('(log unreadable at ' + logPath + ')' + NL);
  }
}
function main(): number {
  // Preflight first, before the log fd and before the lock: a runtime that is
  // absent now will still be absent in four minutes, and discovering it at the
  // twelfth workspace costs the eleven that had nothing wrong with them.
  if (needsContainerRuntime()) {
    const [probeCmd, ...probeRest] = containerRuntimeProbeArgs();
    const probe = spawnSync(probeCmd ?? 'docker', probeRest, { stdio: 'ignore' });
    // Fail closed on any non-zero answer, including a spawn error: an
    // unreadable probe is not evidence that the daemon is up.
    if (probe.error !== undefined || probe.status !== 0) {
      process.stderr.write(containerRuntimeUnavailableMessage() + NL);
      return GATE_COVERAGE_EXIT.runtime;
    }
  }
  const cacheDir = join(homedir(), '.cache', 'fleetmanagement');
  mkdirSync(cacheDir, { recursive: true });
  const lockPath = join(cacheDir, 'gate.lock');
  const logPath = gateLogPath(cacheDir);
  // Both streams go to the FILE, not to pre-commit's pipe. That is the fix:
  // the bytes never traverse the descriptor that was overflowing.
  const fd = openSync(logPath, 'w');
  let coverage: number;
  let merge = 0;
  try {
    process.stderr.write('[gate:coverage] running (output -> ' + logPath + ')' + NL);
    coverage = spawnSync('flock', [...lockArgs(lockPath), 'pnpm', ...coverageArgs()], {
      stdio: ['ignore', fd, fd],
    }).status ?? 1;
    if (coverage === 0) {
      merge = spawnSync('node', [...mergeArgs()], { stdio: ['ignore', fd, fd] }).status ?? 1;
    }
  } finally {
    closeSync(fd);
  }
  if (coverage !== 0) {
    replay(logPath, 'coverage FAILED -- full output');
    return gateExitCode({ coverage, merge: 0 });
  }
  if (merge !== 0) {
    replay(logPath, '90/90/90/90 merge gate FAILED -- full output');
    return gateExitCode({ coverage: 0, merge });
  }
  process.stderr.write('[gate:coverage] passed' + NL);
  return GATE_COVERAGE_EXIT.ok;
}
const isMain = process.argv[1]?.endsWith('gate-coverage.ts') ?? false;
if (isMain) {
  process.exit(main());
}
/* v8 ignore stop */
