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
function git(args: string[], opts: { cwd?: string; allowFail?: boolean } = {}): string {
  try {
    return execFileSync("git", args, {
      cwd: opts.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
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
interface Tally { ff: number; synced: number; ahead: number; published: number; tracked: number; blocked: number; detached: number }

function runAction(wt: Worktree, act: Action, dryRun: boolean, t: Tally): void {
  const w = (s: string) => process.stdout.write(s + String.fromCharCode(10));
  const e = (s: string) => process.stderr.write(s + String.fromCharCode(10));
  const tag = (c: string, s: string) => c + s + C.reset;
  const DRY = dryRun ? C.dim + " [dry-run]" + C.reset : '';
  switch (act.kind) {
    case "detached":
      w(tag(C.dim, "skip") + "   " + label(wt) + " (detached HEAD)"); t.detached++; return;
    case "synced":
      w(tag(C.green, "sync") + "   " + label(wt) + " (up to date)"); t.synced++; return;
    case "ahead":
      w(tag(C.yellow, "ahead") + "  " + label(wt) + " (" + act.ahead + " ahead of remote; nothing to pull)"); t.ahead++; return;
    case "ff":
      if (!dryRun) git(["merge", "--ff-only", "@{u}"], { cwd: wt.path });
      w(tag(C.green, "ff") + "     " + label(wt) + " (" + act.behind + " behind -> fast-forwarded)" + DRY); t.ff++; return;
    case "publish":
      if (!dryRun) git(["push", "-u", "origin", act.branch], { cwd: wt.path });
      w(tag(C.green, "pub") + "    " + label(wt) + " (published + tracking origin/" + act.branch + ")" + DRY); t.published++; return;
    case "set-upstream":
      if (!dryRun) git(["branch", "--set-upstream-to=origin/" + act.branch, act.branch], { cwd: wt.path });
      w(tag(C.green, "track") + "  " + label(wt) + " (set upstream -> origin/" + act.branch + ")" + DRY); t.tracked++; return;
    case "blocked": {
      const why = act.reason === "dirty"
        ? "uncommitted changes block fast-forward (" + act.behind + " behind) -- commit or stash"
        : "DIVERGED: " + act.ahead + " ahead AND " + act.behind + " behind -- refusing to auto-reconcile";
      e(tag(C.red, "BLOCK") + "  " + label(wt) + " (" + why + ")"); t.blocked++; return;
    }
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const dryRun = argv.includes("--dry-run");
  process.stdout.write(C.dim + "Fetching origin (prune)..." + C.reset + String.fromCharCode(10));
  git(["fetch", "--all", "--prune"]);
  const t: Tally = { ff: 0, synced: 0, ahead: 0, published: 0, tracked: 0, blocked: 0, detached: 0 };
  for (const wt of listWorktrees()) {
    try {
      runAction(wt, classify(observe(wt)), dryRun, t);
    } catch (err) {
      t.blocked++;
      const msg = err instanceof Error ? err.message.split(String.fromCharCode(10))[0] : String(err);
      process.stderr.write(C.red + "BLOCK" + C.reset + "  " + label(wt) + " (" + msg + ")" + String.fromCharCode(10));
    }
  }
  process.stdout.write(
    String.fromCharCode(10) + C.dim + "Summary:" + C.reset + " " +
      C.green + t.ff + " ff" + C.reset + ", " + t.synced + " synced" + ", " +
      t.published + " published" + ", " + t.tracked + " tracked" + ", " +
      t.ahead + " ahead" + ", " + t.detached + " detached" + ", " +
      (t.blocked > 0 ? C.red : C.dim) + t.blocked + " blocked" + C.reset + String.fromCharCode(10),
  );
  return t.blocked > 0 ? 1 : 0;
}

// Guarded entry point: only runs when executed directly, never on import.
const invoked = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invoked) process.exit(main());
