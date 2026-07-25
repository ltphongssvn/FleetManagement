// scripts/gate-integration.ts
// Runs a heavy, container-backed gate under a HOST-WIDE lock so concurrent git
// worktrees QUEUE instead of trampling each other.
//
// Why this exists: see scripts/host-gate.ts. Short version -- the api
// integration lane is already fully serialized inside a run, yet still timed out
// at 180s in beforeAll, because another worktree on the same host was running
// its own container-backed gate. No per-run knob can see a sibling process, so
// the mutual exclusion has to be host-level. flock(1) provides it: crash-safe
// (kernel releases on process death), no daemon, already present on the box.
//
// Usage (always via pnpm, never ad hoc):
//   pnpm run gate:integration -- --filter=@fleet/api --filter=@fleet/domain
// Everything after -- is appended to the turbo invocation.
//
// Flags:
//   --no-wait   fail immediately instead of queueing when the lock is held
//   --force     skip the readiness preflight (still takes the lock)
import { spawn, execFileSync } from 'node:child_process';
import { loadavg, cpus, tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateHostReadiness,
  buildFlockArgs,
  TEST_CONTAINER_PREFIX,
  type HostSnapshot,
} from './host-gate.js';

// One lock file per host, shared by every worktree.
const LOCK_PATH = join(tmpdir(), 'fleet-integration-gate.lock');
// Queue budget: long enough to outlast a legitimate sibling gate, short enough
// that a wedged host fails loudly instead of hanging overnight.
const WAIT_SECONDS = 3600;

// MemAvailable is the kernel own estimate of what is usable without swapping --
// far more meaningful here than MemFree, which excludes reclaimable cache.
function readAvailableGiB(): number {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    for (const line of meminfo.split('\n')) {
      if (line.startsWith('MemAvailable:')) {
        const kb = Number(line.replace(/[^0-9]/g, ''));
        if (Number.isFinite(kb) && kb > 0) return kb / 1024 / 1024;
      }
    }
  } catch {
    // Non-Linux or unreadable: fall through to a permissive value so the guard
    // never blocks a host it cannot measure.
  }
  return Number.POSITIVE_INFINITY;
}

function listTestContainers(): readonly string[] {
  try {
    const out = execFileSync('docker', ['ps', '--format', '{{.Names}}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(TEST_CONTAINER_PREFIX));
  } catch {
    // docker absent or not running: nothing to contend with.
    return [];
  }
}

// The worktree hash the pg global-setup uses to name its container. Derived the
// same way the harness derives it, so own-vs-foreign comparison is exact.
function ownContainerName(): string | null {
  const fromEnv = process.env['FLEET_PG_TEST_CONTAINER'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}

function snapshotHost(): HostSnapshot {
  const load1 = loadavg()[0] ?? 0;
  return {
    load1,
    cores: cpus().length,
    availableGiB: readAvailableGiB(),
    testContainerNames: listTestContainers(),
    ownContainerName: ownContainerName(),
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const noWait = argv.includes('--no-wait');
  const force = argv.includes('--force');
  // pnpm run <script> -- <args> forwards a LITERAL -- as argv[0]. Leaving it in
  // place puts a bare -- into the turbo command line, which is turbo signal to
  // forward everything after it to the underlying package scripts -- that is how
  // --filter ended up being handed to eslint:
  //   eslint . --filter=@fleet/domain -> Invalid option '--filter'
  // Strip every bare -- so the caller flags stay TURBO flags.
  const passthrough = argv.filter(
    (a) => a !== '--no-wait' && a !== '--force' && a !== '--',
  );

  if (!force) {
    const readiness = evaluateHostReadiness(snapshotHost());
    if (!readiness.ready) {
      console.error('gate:integration: host is saturated ->');
      for (const p of readiness.problems) console.error('  - ' + p);
      console.error('');
      console.error('This run would contend for CPU/RAM and produce 180s beforeAll timeouts');
      console.error('that look like test failures but are not. Waiting for the lock instead.');
    }
  }

  // Turbo flags (--filter, --force, --dry, ...) MUST come before any bare
  // -- separator; anything after -- is forwarded to the underlying package
  // scripts. Placing them last made turbo hand --filter to eslint:
  //   eslint . --filter=@fleet/domain -> Invalid option '--filter'
  // So passthrough args are spliced in as TURBO flags, right after the task
  // list, and we never append a bare -- ourselves.
  const turbo = [
    'pnpm', 'exec', 'turbo', 'run',
    'typecheck', 'lint', 'test:unit', 'test:integration',
    '--concurrency=1',
    ...passthrough,
  ];
  const flockArgs = buildFlockArgs(LOCK_PATH, noWait ? 1 : WAIT_SECONDS, turbo);

  console.error('gate:integration: acquiring host lock ' + LOCK_PATH +
    (noWait ? ' (no-wait)' : ' (queueing up to ' + String(WAIT_SECONDS) + 's)'));

  const child = spawn('flock', [...flockArgs], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
  });
  child.on('error', (err) => {
    console.error('gate:integration: failed to spawn flock: ' + err.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main();
