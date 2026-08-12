// scripts/deps-reconcile-cli.ts
// GREEN (t82 deps-reconcile arc, 2026-08-04): the deps:reconcile driver.
// Argv in, spawnSync in, process.exit out. Every decision belongs to a tested
// module; what lives here is wiring too small to hide a defect.
//
// COMPOSITION, all imported and none reimplemented:
//   listing   parseWorktreePorcelain + listWorktreesArgs (worktree-close*, 5 tests)
//   tier 1    classifyDepsCandidate + the two mtime readers (sync-worktrees.ts)
//   tier 2    probeDeps (worktree-deps-probe.ts, the shared adapter)
//   sweep     runReconcile (deps-reconcile-runner.ts, 15 tests, injected spawn)
//   verdict   reconcileExitCode + RECONCILE_EXIT (deps-reconcile.ts, 34 tests)
//
// ARGV USES node:util parseArgs, not a hand-rolled loop. Stable since Node 20
// and this repo pins node >=22, so it costs nothing. Two properties matter more
// than tidiness. strict is the DEFAULT, so an unknown flag throws instead of
// being silently ignored -- a swallowed --exceute would otherwise produce a
// confident no-op the operator reads as a successful run. And positionals are
// structurally separate from options, so a path can never be mistaken for
// consent; argv.includes('--execute'), the first draft here, could not tell a
// flag from a value.
//
// TIER 1 BEFORE TIER 2, same reason sync:worktrees does it: the probe costs
// ~7.7s per worktree, so probing all 45 unfiltered would add ~5.8 minutes.
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { listWorktreesArgs } from './worktree-close-cli.js';
import { parseWorktreePorcelain } from './worktree-close.js';
import { classifyDepsCandidate, type DepsProbe } from './worktree-deps-status.js';
import { probeDeps } from './worktree-deps-probe.js';
import {
  newestManifestMtimeMs,
  readValidationTimestampMs,
} from './sync-worktrees.js';
import {
  runReconcile,
  type ReconcileTarget,
  type SpawnFn,
} from './deps-reconcile-runner.js';
import { RECONCILE_EXIT, reconcileExitCode } from './deps-reconcile.js';
const NL = String.fromCharCode(10);
// ---- pure argv parsing ----
export interface ReconcileArgv {
  execute: boolean;
  only: string | null;
  verbose: boolean;
}
// Declarative: Node owns the loop, so no bespoke parsing survives to drift.
// allowPositionals is required in strict mode to accept a worktree path at all.
export function parseReconcileArgv(argv: readonly string[]): ReconcileArgv {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      execute: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    execute: values.execute,
    verbose: values.verbose,
    only: positionals[0] ?? null,
  };
}
// ---- pure target assembly ----
export interface WorktreeListEntry {
  path: string;
  branch: string | null;
}
export type ProbeFn = (path: string) => DepsProbe;
// The probe is a PARAMETER so selection is testable without spawning pnpm, and
// so a filtered run provably probes only its one target. Detached worktrees are
// included on purpose: dependency drift is a property of node_modules, not of
// which branch happens to be checked out.
//
// An unknown filter THROWS rather than returning an empty list: an empty sweep
// exits 0 and reads as success, which is the worst possible response to a typo.
export function buildTargets(
  entries: readonly WorktreeListEntry[],
  only: string | null,
  probe: ProbeFn,
): ReconcileTarget[] {
  const selected = only === null ? entries : entries.filter((e) => e.path === only);
  if (only !== null && selected.length === 0) {
    throw new Error(
      'not a worktree root: ' + only + NL + 'known roots:' + NL +
        entries.map((e) => '  ' + e.path).join(NL),
    );
  }
  return selected.map((e) => ({ path: e.path, probe: probe(e.path) }));
}
/* v8 ignore start -- side-effecting entrypoint; pure parts above are unit-tested */
// The ONE untested line of this arc, by necessity: it adapts spawnSync to the
// SpawnFn signature the runner already tests against with a recorder. Every
// option it passes -- sanitized env, bounded timeout, SIGTERM -- is asserted
// in deps-reconcile-runner.test.ts by inspecting what the spawn RECEIVED.
const realSpawn: SpawnFn = (cwd, args, opts) => {
  const r = spawnSync('pnpm', [...args], {
    cwd,
    encoding: 'utf8',
    env: opts.env,
    timeout: opts.timeout,
    killSignal: opts.killSignal,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8' }).trim();
}
// TIER 1 (free mtime comparison) gates TIER 2 (the ~7.7s probe). A worktree
// whose manifests all predate the last validated install cannot be stale, so
// the expensive probe is never spawned for it.
function resolveProbe(path: string): DepsProbe {
  const state = readValidationTimestampMs(path);
  const candidate = classifyDepsCandidate({
    stateFilePresent: state.present,
    lastValidatedTimestampMs: state.ts,
    newestManifestMtimeMs: newestManifestMtimeMs(path),
  });
  if (candidate.kind === 'ok') return { kind: 'deps-ok' };
  return probeDeps(path);
}
function mainDepsReconcile(): number {
  let argv: ReconcileArgv;
  try {
    argv = parseReconcileArgv(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(msg + NL);
    process.stderr.write(
      'usage: turbo run deps:reconcile -- [<worktree-path>] [--execute] [--verbose]' + NL,
    );
    return RECONCILE_EXIT.usage;
  }
  const entries = parseWorktreePorcelain(git(listWorktreesArgs()));
  let targets: ReconcileTarget[];
  try {
    targets = buildTargets(entries, argv.only, resolveProbe);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + NL);
    return RECONCILE_EXIT.usage;
  }
  const report = runReconcile(targets, realSpawn, { execute: argv.execute });
  for (const line of report.lines) process.stdout.write(line + NL);
  const s = report.summary;
  process.stdout.write(
    NL + 'Summary: ' + String(s.reconciled) + ' reconciled, ' +
      String(s.divergent) + ' divergent, ' + String(s.failed) + ' failed, ' +
      String(s.skipped) + ' skipped' +
      (argv.execute ? '' : '  [DRY RUN -- pass --execute to apply]') + NL,
  );
  return reconcileExitCode(s);
}
const isMain = process.argv[1]?.endsWith('deps-reconcile-cli.ts') ?? false;
if (isMain) {
  process.exit(mainDepsReconcile());
}
/* v8 ignore stop */
