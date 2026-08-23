// scripts/host-gate.ts
// Host-level guard for container-backed integration gates.
//
// ROOT CAUSE THIS ELIMINATES
// This repo runs 40+ git worktrees on ONE WSL host (~9.7GiB). The api
// integration lane is ALREADY fully serialized within a run
// (apps/api/vitest.integration.config.ts: fileParallelism:false,
// sequence.concurrent:false), and it still hit 180s beforeAll timeouts. That
// proves the contention is not intra-run: a SIBLING worktree was running its own
// container-backed gate at the same time. Measured during a failing run:
//   load average 19.27 (8 cores), 2.0GiB available, and a foreign container
//   fleet-pg-test-12f2574406eb while our own run owned 50d50c60da41.
// After that sibling finished, the same two suites passed in 38s against a 180s
// budget (4.7x margin) -- starved, never broken.
//
// No per-run setting (maxWorkers, fileParallelism, turbo --concurrency) can
// observe another process, and percentage-based caps are recomputed per run so N
// concurrent runs each take their share and collectively oversubscribe by Nx.
// The control therefore has to live at the HOST level. Two pieces:
//   1. buildFlockArgs      - serialize gates across worktrees via flock(1).
//   2. evaluateHostReadiness - fail fast with an actionable message instead of
//                              burning 50 minutes on an uninterpretable run.
// Both are pure so they are unit-tested with zero I/O; the thin executable
// wrappers live in gate-integration.ts.

// Test containers are named fleet-pg-test-<worktreeHash>. That worktree-scoped
// naming is what makes a foreign run detectable at a glance -- never make it a
// fixed name.
export const TEST_CONTAINER_PREFIX = 'fleet-pg-test-';

// A gate needs roughly one core and ~1GiB of headroom for Postgres cold start
// plus the node/tsc processes around it. Above 2.0 load per core the host is
// swapping rather than working.
export const MAX_LOAD_PER_CORE = 2.0;
export const MIN_AVAILABLE_GIB = 2.0;

// Free-disk floor. Disk was the one saturation axis this guard did not
// measure, and it is the axis that took the host down on 2026-07-27: free
// space reached zero, the Docker Desktop VM lost its backing disk, and every
// docker call started failing at the EXEC layer with Input/output error --
// the cli-tools mount had gone hollow while still listed as mounted. Load and
// memory were healthy the whole time, so nothing here could have caught it,
// and eighteen e2e specs reported as product failures for a full suite run.
//
// 10GiB is sized for what one isolated E2E stack actually consumes: a
// --no-cache rebuild of two app images plus five service images, their
// volumes, and Playwright traces/screenshots on retry. Below that a run can
// still START and then die mid-build, which is the expensive failure mode.
export const MIN_DISK_GIB = 10.0;

export interface HostSnapshot {
  readonly load1: number;
  readonly cores: number;
  readonly availableGiB: number;
  // Free space on the filesystem backing this worktree. NOTE: Docker
  // Desktop on WSL2 keeps its images in a SEPARATE vhdx that this cannot
  // see, so a healthy figure here does not prove the daemon has room. It is
  // still worth measuring: the pnpm store, node_modules, build output and
  // Playwright artifacts all land here. Non-finite or negative means
  // UNMEASURABLE, never full (see evaluateHostReadiness).
  readonly availableDiskGiB: number;
  // Names of currently running test containers (any worktree).
  readonly testContainerNames: readonly string[];
  // This worktree own container name, or null when it cannot be determined.
  readonly ownContainerName: string | null;
}

export interface HostReadiness {
  readonly ready: boolean;
  // Every reason the host is unfit, reported together so one run surfaces the
  // full picture instead of one-at-a-time.
  readonly problems: readonly string[];
}

// Decide whether it is safe to start a heavy, container-backed gate right now.
// Fail-safe: when the own-container name is unknown, ANY test container counts
// as foreign, so an unidentifiable state never yields a false OK.
export function evaluateHostReadiness(snapshot: HostSnapshot): HostReadiness {
  const problems: string[] = [];

  const loadPerCore = snapshot.cores > 0 ? snapshot.load1 / snapshot.cores : snapshot.load1;
  if (loadPerCore > MAX_LOAD_PER_CORE) {
    problems.push(
      'load ' +
        snapshot.load1.toFixed(2) +
        ' over ' +
        String(snapshot.cores) +
        ' cores (' +
        loadPerCore.toFixed(2) +
        ' per core, ceiling ' +
        MAX_LOAD_PER_CORE.toFixed(1) +
        ')',
    );
  }

  if (snapshot.availableGiB < MIN_AVAILABLE_GIB) {
    problems.push(
      'only ' +
        snapshot.availableGiB.toFixed(1) +
        'GiB available (floor ' +
        MIN_AVAILABLE_GIB.toFixed(1) +
        'GiB)',
    );
  }

  // Fail-safe on two axes at once. A JS statfs binding truncates f_bavail to
  // 32 bits, so a filesystem with more than ~17.6TB free reports a NEGATIVE
  // figure; read naively that is the fullest disk imaginable and this guard
  // would block every run on precisely the roomiest hosts. Requiring a finite,
  // non-negative reading before comparing means nonsensical is treated as
  // unknown, matching how availableGiB already yields to an unmeasurable host.
  const diskKnown = Number.isFinite(snapshot.availableDiskGiB) && snapshot.availableDiskGiB >= 0;
  if (diskKnown && snapshot.availableDiskGiB < MIN_DISK_GIB) {
    problems.push(
      'only ' +
        snapshot.availableDiskGiB.toFixed(1) +
        'GiB free disk (floor ' +
        MIN_DISK_GIB.toFixed(1) +
        'GiB)',
    );
  }

  const foreign = snapshot.testContainerNames.filter((name) => name !== snapshot.ownContainerName);
  if (foreign.length > 0) {
    problems.push('another worktree is mid-run: ' + foreign.join(', '));
  }

  return { ready: problems.length === 0, problems };
}

// SINGLE SOURCE OF TRUTH for the host-wide gate lock path.
//
// flock(1) is ADVISORY and scoped to an INODE: mutual exclusion exists only
// while every cooperating process locks the SAME file. The pre-push coverage
// hook has locked $HOME/.cache/fleetmanagement/gate.lock since 9710dd8; fab24dd
// then gave gate:integration its own path under the temp dir. Two paths means
// two inodes, which means the two heaviest gates on this host never excluded
// each other at all -- a sibling worktree kept starving whichever run went
// second, producing 180s beforeAll timeouts that read as test failures.
//
// The temp dir is also the wrong home for a lock: it is world-writable, and
// tmpfiles ageing only skips files that are locked AT THAT MOMENT, so an idle
// lock file can be swept and recreated -- after which two processes hold locks
// on different inodes and both proceed. A cache-dir path is stable and private.
//
// Pure: env and home are injected so this is unit-testable with zero I/O.
export function resolveGateLockPath(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): string {
  // XDG basedir spec: a relative XDG_CACHE_HOME is invalid and must be ignored.
  const xdg = env['XDG_CACHE_HOME'];
  const base = typeof xdg === 'string' && xdg.startsWith('/') ? xdg : homeDir + '/.cache';
  return base + '/fleetmanagement/gate.lock';
}

// Build the flock(1) argv that serializes gates across worktrees. flock is
// crash-safe: the kernel releases the lock when the holding process dies, so a
// killed gate never wedges the host. The wait budget bounds the queue so a
// genuinely stuck run surfaces as a failure instead of an infinite hang.
export function buildFlockArgs(
  lockPath: string,
  waitSeconds: number,
  command: readonly string[],
): readonly string[] {
  if (command.length === 0) {
    throw new Error('buildFlockArgs: refusing to lock around an empty command');
  }
  if (!Number.isFinite(waitSeconds) || waitSeconds <= 0) {
    throw new Error(
      'buildFlockArgs: waitSeconds must be positive (a gate must never hang forever)',
    );
  }
  // util-linux flock(1) file-then-command mode takes the command DIRECTLY after
  // the lock path. Passing a literal -- separator makes flock try to EXECUTE it:
  //   flock: failed to execute --: No such file or directory
  // Verified against flock from util-linux 2.39.3.
  return ['-w', String(waitSeconds), lockPath, ...command];
}
