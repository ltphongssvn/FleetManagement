// scripts/worktree-deps-probe.ts
// The tier-2 dependency probe: the ONE imperative adapter that asks pnpm
// whether a worktree's node_modules matches its lockfile.
//
// WHY ITS OWN MODULE. It was a private function inside sync-worktrees.ts,
// correct while sync:worktrees was its only caller. deps:reconcile is now a
// second shell needing the same probe, and both alternatives were wrong.
// Copying it would duplicate three separately hard-won fixes, so the next pnpm
// change would repair one copy and silently leave the other. Exporting it from
// sync-worktrees.ts would make a pnpm probe reachable only through a git-sync
// module, so the reconcile CLI would import a git tool to run pnpm.
//
// Functional-core / imperative-shell decides it: in a large system you do not
// have one giant shell, you have many small adapters that several shells wrap.
// This is that adapter. sync-worktrees.ts and deps-reconcile-cli.ts are two
// shells over it; the pure decision cores live in worktree-deps-status.ts.
//
// THE TIMEOUT CONSTANT LIVES HERE, and sync-worktrees.ts re-exports it for
// back-compat rather than declaring its own. Two modules exporting the same
// named constant is the duplication this arc already had to remove once.
//
// THREE FIXES ENCODED HERE, each from a real failure. Do not simplify any of
// them without reading the reason.
//
// 1. spawnSync, not execFileSync: a non-zero exit is DATA here, not a throw. A
//    drifted worktree exits non-zero by design, and its reason string is the
//    thing worth reporting.
// 2. env is SANITIZED via buildProbeEnv. This runs inside a pnpm process and a
//    child inherits npm_config_* from its parent. Env config OUTRANKS the
//    --config. flag, so an inherited verify-deps-before-run=warn silently
//    downgraded the probe: it exited 0 in ~0.5s inside the task while the same
//    command took ~7.7s and exited 1 standalone. Every stale worktree read as
//    healthy -- a green light produced by the measurement rather than by the
//    thing measured.
// 3. BOTH streams are read. pnpm does not commit to one, and its own tracker
//    documents WARN lines on stdout breaking --json parsing (issues 10200,
//    10923) and verify-deps data on stdout even under --silent (issue 11636).
//    Reading only stderr made every drifted worktree report
//    no-diagnostic-output: the verdict stayed right but the actionable reason
//    was discarded, which is how a report becomes noise operators ignore.
//
// Bounded: a timeout yields a null status, which interpretDepsProbe treats as
// stale and never as a pass. execFileSync has no default timeout, and an
// unbounded child caused the observed 4h17m wedge in sync:worktrees.
//
// Blocking is CORRECT here. Both callers are terminal commands a human runs and
// waits on; there is no event loop to starve, and a synchronous call keeps the
// failure mode a plain non-zero exit the shell can branch on.
import { spawnSync } from 'node:child_process';
import {
  buildProbeEnv,
  interpretDepsProbe,
  joinProbeStreams,
  type DepsProbe,
} from './worktree-deps-status.js';
const DEPS_PROBE_TIMEOUT_MS = 120_000;
// Reuses pnpm's own checkDepsStatus via the verify flag, WITHOUT changing the
// repo-wide setting and without adding a dependency.
export function probeDeps(root: string): DepsProbe {
  const r = spawnSync(
    'pnpm',
    ['--config.verifyDepsBeforeRun=error', '--reporter=ndjson', 'exec', 'true'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: DEPS_PROBE_TIMEOUT_MS,
      env: buildProbeEnv(process.env),
      killSignal: 'SIGTERM',
    },
  );
  // r.stderr is typed string under encoding utf8, so no fallback is needed;
  // adding one trips no-unnecessary-condition in the type-aware lint.
  return interpretDepsProbe(r.status, joinProbeStreams(r.stderr, r.stdout));
}
