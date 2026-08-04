// scripts/deps-reconcile-runner.ts
// GREEN (t82 deps-reconcile arc, 2026-08-04): the reconcile sweep, with its
// spawn INJECTED so the loop is unit-testable by execution.
//
// WHY INJECTION RATHER THAN A SOURCE-CONTRACT GUARD. The first draft put this
// loop inside the CLI driver and protected it with a wiring test that read its
// own source: assertions like includes(buildProbeEnv) and
// indexOf(resolveExecute) < indexOf(spawnSync). Three defects made that the
// wrong reach. Comment stripping by line prefix misses block comments, trailing
// comments and string literals -- a false positive of exactly that shape
// already fired on this arc when a shell gate matched a forbidden flag name
// inside the comment explaining why it is forbidden. Lexical position is not
// control flow, so moving a helper could satisfy or break the ordering rule
// without changing behaviour. And the presence of an identifier never proves it
// reaches the call that needs it.
//
// So the untestable surface is made SMALL instead of guarded harder. This
// module owns every decision and every count; the CLI that wraps it is argv in,
// spawnSync in, process.exit out. The source-contract pattern remains correct
// for sync-worktrees.ts, which walks 45 real worktrees and genuinely cannot be
// unit-run -- it was simply not needed here, where injection was available.
//
// SEQUENTIAL. pnpm maintainers confirm concurrent installs against one
// content-addressable store are safe because store operations are atomic, so
// the store is not the constraint. Memory contention on a 9.7GiB box is, which
// is the same SSOT that pins broad gates to concurrency 1. Recorded caveat:
// pnpm store prune must never run while an install is running.
import {
  decideReconcile,
  healArgs,
  interpretHealResult,
  reconcileExitCode,

  type ReconcileSummary,
} from './deps-reconcile.js';
import { buildProbeEnv, joinProbeStreams, type DepsProbe } from './worktree-deps-status.js';
// A heal is a frozen install: no resolution step, packages already in the
// store. Five minutes is generous for the slowest cold worktree and still
// finite, which is the point -- sync-worktrees.ts documents a 4h17m wedge
// caused by an unbounded child, and every spawn here must be incapable of it.
export const HEAL_TIMEOUT_MS = 300_000;
export interface SpawnOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
}
export interface SpawnOptions {
  env: Record<string, string>;
  timeout: number;
  killSignal: 'SIGTERM';
}
// The seam. Production passes a spawnSync wrapper; tests pass a recorder, so
// "never spawn in dry run" is asserted as an empty call list rather than as the
// absence of a substring.
export type SpawnFn = (
  cwd: string,
  args: readonly string[],
  opts: SpawnOptions,
) => SpawnOutcome;
export interface ReconcileTarget {
  path: string;
  probe: DepsProbe;
}
export interface RunOptions {
  execute: boolean;
  sourceEnv?: Record<string, string | undefined>;
  timeoutMs?: number;
}
export interface ReconcileReport {
  planned: number;
  summary: ReconcileSummary;
  exitCode: number;
  lines: readonly string[];
}
export function runReconcile(
  targets: readonly ReconcileTarget[],
  spawn: SpawnFn,
  options: RunOptions,
): ReconcileReport {
  const summary: ReconcileSummary = { reconciled: 0, divergent: 0, failed: 0, skipped: 0 };
  const lines: string[] = [];
  const timeout = options.timeoutMs ?? HEAL_TIMEOUT_MS;
  // Built ONCE, outside the loop: the sanitized env is a property of this
  // process, not of any worktree, and rebuilding it per target would invite a
  // future edit that sanitizes some children and not others.
  const env = buildProbeEnv(options.sourceEnv ?? process.env);
  const args = healArgs();
  let planned = 0;
  for (const target of targets) {
    const plan = decideReconcile(target.probe);
    if (plan.action === 'skip') {
      summary.skipped += 1;
      lines.push('skip       ' + target.path + ' (' + plan.reason + ')');
      continue;
    }
    planned += 1;
    // DRY RUN IS PROVABLY INERT: the spawn is unreachable on this path, so a
    // preview cannot install. Consent is checked before the call, never inside
    // it, so there is no branch in which a spawn happens and is then undone.
    if (!options.execute) {
      lines.push('would-heal ' + target.path + ' (' + plan.detail + ')');
      continue;
    }
    const outcome = spawn(target.path, args, { env, timeout, killSignal: 'SIGTERM' });
    const result = interpretHealResult(
      outcome.status,
      joinProbeStreams(outcome.stderr, outcome.stdout),
    );
    // One worktree's failure must never abandon the other 44: the sweep records
    // the outcome and moves on. The exit code carries the verdict at the end.
    if (result.kind === 'reconciled') {
      summary.reconciled += 1;
      lines.push('reconciled ' + target.path);
      continue;
    }
    if (result.kind === 'divergent') {
      summary.divergent += 1;
      lines.push('divergent  ' + target.path + ' [' + result.source + '] ' + result.reason);
      continue;
    }
    summary.failed += 1;
    lines.push('failed     ' + target.path + ' [' + result.source + '] ' + result.reason);
  }
  return { planned, summary, exitCode: reconcileExitCode(summary), lines };
}
