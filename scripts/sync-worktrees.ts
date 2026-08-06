// scripts/sync-worktrees.ts
// Functional core + imperative shell for safe multi-worktree sync.
//
// CORE (pure, exported, unit-tested): classify(state) -> Action. No I/O.
//   Decides FF vs publish vs set-upstream vs blocked from an observed state.
//   blocked{dirty}          -- behind but uncommitted tree (the old crash).
//   blocked{diverged-remote}-- ahead AND behind: never auto-reconcile/force.
// SHELL (side effects): gathers state via git, runs the action, downgrades any
//   thrown git error to blocked{error}, accumulates, exits 1 if any blocked.
//   --dry-run previews planned actions and mutates nothing.
//
// Root-cause fixes vs the original:
//   1. The FF merge is guarded (isDirty precheck + per-worktree try/catch) so
//      one dirty worktree can no longer abort the whole run.
//   2. no-upstream branches are published / set-upstream instead of skipped,
//      so subsequent runs have nothing to skip. push is plain (never forced).
//   3. Entry point guarded (import.meta) so importing in tests runs nothing.
//
// Run: pnpm exec turbo run sync:worktrees   (root-scoped //# task)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classifyDepsCandidate } from './worktree-deps-status.js';
// TIER 2 lives in its own adapter now: deps:reconcile is a second shell that
// needs the same probe, and neither copying it nor exporting it from this
// git-sync module was acceptable. See worktree-deps-probe.ts for the three
// historical fixes it carries.
import { probeDeps } from './worktree-deps-probe.js';

// ------------------------------- CORE (pure) -------------------------------
export interface WorktreeState {
  branch: string | null;
  hasUpstream: boolean;
  originBranchExists: boolean;
  ahead: number;
  behind: number;
  isDirty: boolean;
}
export type BlockedReason = "dirty" | "diverged-remote";
export type Action =
  | { kind: "detached" }
  | { kind: "synced" }
  | { kind: "ff"; behind: number }
  | { kind: "ahead"; ahead: number }
  | { kind: "publish"; branch: string }
  | { kind: "set-upstream"; branch: string }
  | { kind: "blocked"; reason: BlockedReason; ahead: number; behind: number };

// Total decision function. Order matters: detached, then upstream presence,
// then the ahead/behind quadrants with the dirty gate on the FF path.
export function classify(s: WorktreeState): Action {
  if (s.branch === null) return { kind: "detached" };
  if (!s.hasUpstream) {
    return s.originBranchExists
      ? { kind: "set-upstream", branch: s.branch }
      : { kind: "publish", branch: s.branch };
  }
  if (s.ahead > 0 && s.behind > 0) {
    return { kind: "blocked", reason: "diverged-remote", ahead: s.ahead, behind: s.behind };
  }
  if (s.ahead > 0) return { kind: "ahead", ahead: s.ahead };
  if (s.behind > 0) {
    return s.isDirty
      ? { kind: "blocked", reason: "dirty", ahead: s.ahead, behind: s.behind }
      : { kind: "ff", behind: s.behind };
  }
  return { kind: "synced" };
}

// ------------------------------ SHELL (impure) -----------------------------
// execFileSync has NO timeout by default: a hung child (a git push stalled on
// network or an auth prompt for a large no-upstream branch) blocks the event
// loop FOREVER -- the observed 4h17m wedge after auto-push of no-upstream
// branches was added. Every git subprocess therefore gets a bounded timeout +
// SIGTERM killSignal so a stuck call is killed and surfaces as a throw, which
// the per-worktree try/catch downgrades to blocked{error}. Read-only commands
// get a short cap; network commands (push/fetch/pull/clone/ls-remote) get a
// generous-but-finite cap.
export const GIT_READ_TIMEOUT_MS = 30_000;
export const GIT_NETWORK_TIMEOUT_MS = 120_000;
const GIT_NETWORK_VERBS = new Set(['push', 'fetch', 'pull', 'clone', 'ls-remote']);
export interface GitExecOptions {
  cwd?: string;
  encoding: 'utf8';
  stdio: ['ignore', 'pipe', 'pipe'];
  timeout: number;
  killSignal: 'SIGTERM';
}
// Pure: maps a git argv (+ optional cwd) to the execFileSync options, choosing
// the timeout by whether the first arg is a network verb. Exported for unit test.
export function gitExecOptions(args: string[], cwd?: string): GitExecOptions {
  const verb = args[0] ?? '';
  const timeout = GIT_NETWORK_VERBS.has(verb) ? GIT_NETWORK_TIMEOUT_MS : GIT_READ_TIMEOUT_MS;
  const base: GitExecOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    killSignal: 'SIGTERM',
  };
  return cwd === undefined ? base : { ...base, cwd };
}

function git(args: string[], opts: { cwd?: string; allowFail?: boolean } = {}): string {
  try {
    return execFileSync("git", args, gitExecOptions(args, opts.cwd)).trim();
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}
interface Worktree { path: string; branch: string | null }
function listWorktrees(): Worktree[] {
  const out = git(["worktree", "list", "--porcelain"]);
  const trees: Worktree[] = [];
  let cur: Partial<Worktree> = {};
  for (const line of out.split(String.fromCharCode(10))) {
    if (line.startsWith("worktree ")) {
      if (cur.path) trees.push({ path: cur.path, branch: cur.branch ?? null });
      cur = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace("refs/heads/", '');
    } else if (line === "detached") {
      cur.branch = null;
    }
  }
  if (cur.path) trees.push({ path: cur.path, branch: cur.branch ?? null });
  return trees;
}
function currentUpstream(cwd: string): string | null {
  const u = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd, allowFail: true });
  return u || null;
}
function aheadBehindVs(cwd: string, upstream: string): { ahead: number; behind: number } {
  const counts = git(["rev-list", "--left-right", "--count", "HEAD..." + upstream], { cwd });
  const [aStr, bStr] = counts.split(/\s+/);
  return { ahead: Number(aStr), behind: Number(bStr) };
}
function isDirty(cwd: string): boolean {
  return git(["status", "--porcelain"], { cwd }).length > 0;
}
function originBranchExists(cwd: string, branch: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + branch], { cwd, allowFail: true }).length > 0;
}
function observe(wt: Worktree): WorktreeState {
  const upstream = wt.branch ? currentUpstream(wt.path) : null;
  const ab = upstream ? aheadBehindVs(wt.path, upstream) : { ahead: 0, behind: 0 };
  return {
    branch: wt.branch,
    hasUpstream: upstream !== null,
    originBranchExists: wt.branch ? originBranchExists(wt.path, wt.branch) : false,
    ahead: ab.ahead,
    behind: ab.behind,
    isDirty: wt.branch ? isDirty(wt.path) : false,
  };
}
const C = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", dim: "\x1b[2m",
};
function label(wt: Worktree): string {
  return (wt.branch ?? "(detached)") + " " + C.dim + "@ " + wt.path + C.reset;
}
interface Tally { ff: number; synced: number; ahead: number; published: number; tracked: number; blocked: number; detached: number; depsOk: number; depsStale: number; toolchainBlocked: number }

function runAction(wt: Worktree, act: Action, dryRun: boolean, t: Tally): void {
  const w = (s: string): void => { process.stdout.write(s + String.fromCharCode(10)); };
  const e = (s: string): void => { process.stderr.write(s + String.fromCharCode(10)); };
  const tag = (c: string, s: string): string => c + s + C.reset;
  const DRY = dryRun ? C.dim + " [dry-run]" + C.reset : '';
  switch (act.kind) {
    case "detached":
      w(tag(C.dim, "skip") + "   " + label(wt) + " (detached HEAD)"); t.detached++; return;
    case "synced":
      w(tag(C.green, "sync") + "   " + label(wt) + " (up to date)"); t.synced++; return;
    case "ahead":
      w(tag(C.yellow, "ahead") + "  " + label(wt) + " (" + String(act.ahead) + " ahead of remote; nothing to pull)"); t.ahead++; return;
    case "ff":
      if (!dryRun) git(["merge", "--ff-only", "@{u}"], { cwd: wt.path });
      w(tag(C.green, "ff") + "     " + label(wt) + " (" + String(act.behind) + " behind -> fast-forwarded)" + DRY); t.ff++; return;
    case "publish":
      if (!dryRun) git(["push", "-u", "origin", act.branch], { cwd: wt.path });
      w(tag(C.green, "pub") + "    " + label(wt) + " (published + tracking origin/" + act.branch + ")" + DRY); t.published++; return;
    case "set-upstream":
      if (!dryRun) git(["branch", "--set-upstream-to=origin/" + act.branch, act.branch], { cwd: wt.path });
      w(tag(C.green, "track") + "  " + label(wt) + " (set upstream -> origin/" + act.branch + ")" + DRY); t.tracked++; return;
    case "blocked": {
      const why = act.reason === "dirty"
        ? "uncommitted changes block fast-forward (" + String(act.behind) + " behind) -- commit or stash"
        : "DIVERGED: " + String(act.ahead) + " ahead AND " + String(act.behind) + " behind -- refusing to auto-reconcile";
      e(tag(C.red, "BLOCK") + "  " + label(wt) + " (" + why + ")"); t.blocked++; return;
    }
  }
}

// -------------------- DEPENDENCY DRIFT (two-tier) --------------------------
// pnpm v11 defaults verifyDepsBeforeRun to install, self-healing a drifted
// tree before every script. This repo sets it to warn on purpose: with 37
// worktrees and 1810 packages on a 9.7GiB box an implicit install mid-gate is
// destructive (pnpm issues 11556, 11865). But warn only PRINTS, and this task
// fast-forwards refs without touching node_modules -- so drift accumulated
// silently until the canonical root ran this very task on turbo 2.10.6 while
// both origin/main and origin/develop declared 2.10.7.
//
// Reports, never heals: the operator decides when to install. Non-fatal in
// stage 1 -- failing every drifted worktree at once would block the box.
//
// Manifest paths are derived from the GIT worktree path. The state file also
// carries a map of absolute package paths, but git worktree move does not
// rewrite it (pnpm issue 10081), so those keys can point at a directory that
// no longer exists -- observed in this very worktree after its rename.
const WORKSPACE_STATE_REL = 'node_modules/.pnpm-workspace-state-v1.json';
export function readValidationTimestampMs(root: string): { present: boolean; ts: number } {
  const f = join(root, WORKSPACE_STATE_REL);
  if (!existsSync(f)) return { present: false, ts: 0 };
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as {
      lastValidatedTimestamp?: number;
    };
    return { present: true, ts: parsed.lastValidatedTimestamp ?? 0 };
  } catch {
    return { present: false, ts: 0 };
  }
}
const MANIFEST_DIRS = ['apps', 'packages', 'workers'];
export function newestManifestMtimeMs(root: string): number {
  const files: string[] = [
    join(root, 'pnpm-lock.yaml'),
    join(root, 'pnpm-workspace.yaml'),
    join(root, 'package.json'),
    join(root, 'e2e', 'package.json'),
  ];
  for (const dir of MANIFEST_DIRS) {
    const d = join(root, dir);
    if (!existsSync(d)) continue;
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (ent.isDirectory()) files.push(join(d, ent.name, 'package.json'));
    }
  }
  let newest = 0;
  for (const f of files) {
    if (!existsSync(f)) continue;
    const m = statSync(f).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}
// TIER 1 first (free), TIER 2 only on candidates: the probe costs ~7.7s per
// worktree, so probing all 37 would add ~4.7 minutes to a 30s task.
function reportDeps(wt: Worktree, t: Tally, verbose: boolean): void {
  const state = readValidationTimestampMs(wt.path);
  const candidate = classifyDepsCandidate({
    stateFilePresent: state.present,
    lastValidatedTimestampMs: state.ts,
    newestManifestMtimeMs: newestManifestMtimeMs(wt.path),
  });
  if (verbose) {
    process.stdout.write(
      C.dim + '  tier1 ' + candidate.kind + '  ' + wt.path + C.reset +
        String.fromCharCode(10),
    );
  }
  if (candidate.kind === 'ok') {
    t.depsOk++;
    return;
  }
  const probe = probeDeps(wt.path);
  if (verbose) {
    process.stdout.write(
      C.dim + '  tier2 ' + probe.kind + '  ' + wt.path + C.reset +
        String.fromCharCode(10),
    );
  }
  if (probe.kind === 'deps-ok') {
    t.depsOk++;
    return;
  }
  // A poisoned pnpm pin is NOT drift: pnpm cannot run at all, so pointing the
  // operator at pnpm install would be wrong. Reported separately, in red.
  if (probe.kind === 'toolchain-blocked') {
    t.toolchainBlocked++;
    process.stderr.write(
      C.red + 'TOOLCHAIN' + C.reset + '  ' + label(wt) +
        ' (' + probe.reason + ')' + String.fromCharCode(10),
    );
    return;
  }
  t.depsStale++;
  process.stderr.write(
    C.yellow + 'DRIFT' + C.reset + '  ' + label(wt) +
      ' (deps: ' + probe.reason + ')' + String.fromCharCode(10),
  );
}
export function main(argv: string[] = process.argv.slice(2)): number {
  const dryRun = argv.includes("--dry-run");
  // Makes the two tiers observable. Without it depsOk is tallied but never
  // shown, so a worktree that is probed-and-passes is indistinguishable from
  // one that tier 1 never referred -- the exact ambiguity that stalled the
  // first live diagnosis.
  const verboseDeps = argv.includes("--verbose-deps");
  process.stdout.write(C.dim + "Fetching origin (prune)..." + C.reset + String.fromCharCode(10));
  git(["fetch", "--all", "--prune"]);
  const t: Tally = { ff: 0, synced: 0, ahead: 0, published: 0, tracked: 0, blocked: 0, detached: 0, depsOk: 0, depsStale: 0, toolchainBlocked: 0 };
  for (const wt of listWorktrees()) {
    try {
      runAction(wt, classify(observe(wt)), dryRun, t);
      reportDeps(wt, t, verboseDeps);
    } catch (err) {
      t.blocked++;
      // split() is indexed, so under noUncheckedIndexedAccess the first element is
      // string | undefined even though a split always yields at least one entry.
      const msg = err instanceof Error ? (err.message.split(String.fromCharCode(10))[0] ?? err.message) : String(err);
      process.stderr.write(C.red + "BLOCK" + C.reset + "  " + label(wt) + " (" + msg + ")" + String.fromCharCode(10));
    }
  }
  process.stdout.write(
    String.fromCharCode(10) + C.dim + "Summary:" + C.reset + " " +
      C.green + String(t.ff) + " ff" + C.reset + ", " + String(t.synced) + " synced" + ", " +
      String(t.published) + " published" + ", " + String(t.tracked) + " tracked" + ", " +
      String(t.ahead) + " ahead" + ", " + String(t.detached) + " detached" + ", " +
      (t.blocked > 0 ? C.red : C.dim) + String(t.blocked) + " blocked" + C.reset + ", " +
      String(t.depsOk) + " deps-ok" + ", " +
      (t.depsStale > 0 ? C.yellow : C.dim) + String(t.depsStale) + " deps-stale" + C.reset + ", " +
      (t.toolchainBlocked > 0 ? C.red : C.dim) + String(t.toolchainBlocked) + " toolchain-blocked" + C.reset + String.fromCharCode(10),
  );
  return t.blocked > 0 ? 1 : 0;
}

// Guarded entry point: only runs when executed directly, never on import.
const invoked = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invoked) process.exit(main());
