// scripts/sweep-worktrees-cli.ts
// GREEN (worktree-sweep arc slice 2): the batch driver. Composes slice 1 pure
// planSweep with the EXISTING worktree:close pipeline -- decideClose, closePlan,
// resolveCloseInput and the git arg-planners are IMPORTED verbatim, never
// reimplemented, so a sweep close is byte-identical to a single worktree:close
// and cannot bypass its guards. For each candidate the driver gathers the same
// live state (upstream, ahead, dirty, containment, idleHours) AT THE MOMENT OF
// ATTEMPT, so a branch that a concurrent terminal advanced -- or that a terminal
// is actively coding in right now (recent reflog) -- since the census is
// re-checked and correctly refused. Pure parts (parseSweepArgv, formatSweepSummary,
// protectedIntegrationPaths) are unit-tested; main() runs ONLY as entrypoint.
// Precedent: worktree-close-cli.ts.

import { execFileSync } from "node:child_process";
import { planSweep } from "./sweep-worktrees.js";
import { decideClose, closePlan } from "./close-worktree.js";
import {
  parseWorktreePorcelain,
  parseAheadBehind,
  countDirtyFiles,
  parseReflogIdleHours,
  resolveCloseInput,
} from "./worktree-close.js";
import {
  listWorktreesArgs,
  upstreamArgs,
  aheadBehindArgs,
  dirtyArgs,
  containmentArgs,
  reflogArgs,
} from "./worktree-close-cli.js";

const NL = String.fromCharCode(10);
const INTEGRATION_REF = "origin/develop";

// The permanent integration-branch worktrees that must never be swept, matched
// by branch identity. 2026 industry protected-branch convention: a named,
// extensible set (main/master/develop/staging/production), not a hardcoded
// single special case. This is the application-layer pre-filter; git own
// worktree lock is the on-disk backstop (remove refuses a locked worktree
// without --force, and this tool never passes --force), giving defense in depth.
export const PROTECTED_INTEGRATION_BRANCHES = new Set<string>([
  "main",
  "master",
  "develop",
  "staging",
  "production",
]);

// ---- pure argv parsing ----

export interface SweepArgv {
  dryRun: boolean;
}

// --dry-run is opt-in and order-independent; unknown -- flags are ignored.
export function parseSweepArgv(argv: readonly string[]): SweepArgv {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
  }
  return { dryRun };
}

// ---- pure protected-path selection ----

export interface WorktreeBranchEntry {
  path: string;
  branch: string;
}

// Parse at the boundary, do not validate downstream. git worktree list
// --porcelain emits NO branch line for a detached worktree, so
// parseWorktreePorcelain yields branch: null and WorktreeEntry declares
// branch: string | null. SweepEntrySchema, however, requires
// branch: z.string().min(1) and planSweep PARSES its input -- so passing
// entries through unfiltered makes the entire sweep THROW the moment one
// detached worktree exists anywhere in the estate. TypeScript reported exactly
// this at the two call sites in mainSweep, and nothing caught it because
// scripts/ had never been typechecked.
//
// This is a TYPE GUARD, never a cast: a cast would silence the compiler and
// leave the runtime throw in place. Narrowing here means a detached worktree
// cannot be represented downstream, so no guard below has to defend against it.
//
// Excluding them is right on the merits, not merely convenient. A detached
// worktree has no branch to delete and no upstream to compare, so every close
// guard that reasons about a branch is meaningless for it. It was already
// refused downstream by the no-upstream check -- defence in depth working by
// accident. This makes the exclusion deliberate and testable.
export function withBranch(
  entries: readonly { path: string; branch: string | null }[],
): WorktreeBranchEntry[] {
  return entries.filter(
    (e): e is WorktreeBranchEntry => e.branch !== null && e.branch.length > 0,
  );
}

// Every worktree parked on a protected integration branch is permanent
// infrastructure, not sweepable residue. Pure so it is unit-testable without git.
export function protectedIntegrationPaths(
  entries: readonly WorktreeBranchEntry[],
): string[] {
  return entries
    .filter((e) => PROTECTED_INTEGRATION_BRANCHES.has(e.branch))
    .map((e) => e.path);
}

// ---- pure outcome + report ----

export interface SweepOutcome {
  path: string;
  action: "remove" | "remove-keep-branch" | "refuse";
  reasons: string[];
}

// One line per worktree plus a totals footer, so the whole batch is auditable.
export function formatSweepSummary(outcomes: readonly SweepOutcome[]): string {
  const lines: string[] = [];
  let removed = 0;
  let refused = 0;
  let kept = 0;
  for (const o of outcomes) {
    if (o.action === "remove") removed += 1;
    else if (o.action === "remove-keep-branch") kept += 1;
    else refused += 1;
    const reasonText = o.reasons.length > 0 ? " (" + o.reasons.join(",") + ")" : "";
    lines.push("  " + o.action + " " + o.path + reasonText);
  }
  lines.push(
    "sweep: removed=" + String(removed) +
    " refused=" + String(refused) +
    " kept=" + String(kept) +
    " total=" + String(outcomes.length),
  );
  return lines.join(NL);
}

/* v8 ignore start -- side-effecting entrypoint; pure parts above are unit-tested */
function git(args: readonly string[], cwd?: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();
}

function gitAllowFail(args: readonly string[], cwd?: string): string {
  try { return git(args, cwd); } catch { return ""; }
}

// Gather live state AT ATTEMPT TIME and decide; execute the plan unless dryRun.
// One code path for both modes: dry-run skips only the git mutation, never the
// decision, so the printed verdict is exactly what a real run would do. idleHours
// comes from the per-worktree HEAD reflog so an actively-developed worktree is
// refused even when merged and clean.
function sweepOne(path: string, primaryPath: string, dryRun: boolean): SweepOutcome {
  const upstream = gitAllowFail(upstreamArgs(), path);
  const ahead = upstream.length > 0
    ? parseAheadBehind(git(aheadBehindArgs(upstream), path)).ahead
    : 0;
  const idleHours = parseReflogIdleHours(
    gitAllowFail(reflogArgs(), path),
    Math.floor(Date.now() / 1000),
  );
  const input = resolveCloseInput({
    path,
    branch: gitAllowFail(["rev-parse", "--abbrev-ref", "HEAD"], path),
    primaryPath,
    upstream,
    ahead,
    dirtyFileCount: countDirtyFiles(git(dirtyArgs(), path)),
    containedInIntegration: Number(git(containmentArgs(INTEGRATION_REF), path)) === 0,
    idleHours,
  });
  const verdict = decideClose(input);
  if (!dryRun && verdict.action !== "refuse") {
    for (const cmd of closePlan(verdict, input)) git(cmd.slice(1));
  }
  return { path, action: verdict.action, reasons: verdict.reasons };
}

function mainSweep(): number {
  const argv = parseSweepArgv(process.argv.slice(2));
  // primaryPath comes from the RAW list: entries[0] is the primary clone and
  // must be identified even if it were somehow detached.
  const rawEntries = parseWorktreePorcelain(git(listWorktreesArgs()));
  const primaryPath = rawEntries[0]?.path ?? "";
  const entries = withBranch(rawEntries);
  const protectedPaths = protectedIntegrationPaths(entries);
  const plan = planSweep({ entries, protectedPaths });
  const outcomes: SweepOutcome[] = plan.candidates.map((p) =>
    sweepOne(p, primaryPath, argv.dryRun),
  );
  process.stdout.write(formatSweepSummary(outcomes) + NL);
  return 0;
}

const isMain = process.argv[1]?.endsWith("sweep-worktrees-cli.ts") ?? false;
if (isMain) {
  process.exit(mainSweep());
}
/* v8 ignore stop */
