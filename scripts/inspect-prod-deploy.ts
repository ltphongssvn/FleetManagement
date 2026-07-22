// File: FleetManagement/scripts/inspect-prod-deploy.ts
//
// Read-only diagnostic: does the LIVE prod deploy actually contain a given
// fix commit, and is that fix promoted to the base branch? Pure git/deploy
// ledger read -- NO workspace package, NO DB, NO build. Mirrors the
// audit:ci-minutes root-task shape (ledger read + non-zero exit past a
// threshold). computeDeployVerdict is the pure, unit-tested core; the git
// driver only resolves ancestry facts and feeds them in.
//
// Run: pnpm exec turbo run inspect:prod-deploy -- --live <sha> --fix <sha> [--base <ref>]

import { execFileSync } from "node:child_process";

export interface DeployFacts {
  fixInBase: boolean;
  fixInLive: boolean;
  aheadCount: number;
}

export interface DeployVerdict {
  verdict: "EFFECTIVE" | "REDEPLOY-NEEDED" | "NOT-PROMOTED";
  exitCode: 0 | 1;
  lines: string[];
}

// PURE core: resolved facts -> verdict + exit code + printable lines.
export function computeDeployVerdict(f: DeployFacts): DeployVerdict {
  const promoted = f.fixInBase;
  const running = f.fixInLive;
  let verdict: DeployVerdict["verdict"];
  if (!promoted) {
    verdict = "NOT-PROMOTED";
  } else if (!running) {
    verdict = "REDEPLOY-NEEDED";
  } else {
    verdict = "EFFECTIVE";
  }
  const exitCode: 0 | 1 = verdict === "EFFECTIVE" ? 0 : 1;
  const yn = (b: boolean): string => (b ? "YES" : "NO");
  const lines = [
    "fix promoted to base (fix in base):   " + yn(promoted),
    "fix running in live (fix in live):    " + yn(running),
    "base ahead of live by:                " + String(f.aheadCount) + " commits",
    "VERDICT: " + verdict,
    "",
    "RAILWAY MANUAL CHECK: git cannot prove the container was BUILT after",
    "the G1 NEXT_SERVER_ACTIONS_ENCRYPTION_KEY build var was set. Confirm the",
    "live deploy build timestamp is AFTER that var existed, else the key is",
    "not baked in even when the fix commit IS present.",
  ];
  return { verdict, exitCode, lines };
}

// --- git driver (impure; resolves ancestry facts) ---
function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

function isAncestor(anc: string, desc: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", anc, desc], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const live = arg("--live", argv);
  const fix = arg("--fix", argv);
  const base = arg("--base", argv) ?? "origin/main";
  if (!live || !fix) {
    console.error("usage: inspect:prod-deploy -- --live <sha> --fix <sha> [--base <ref>]");
    process.exit(2);
  }
  const facts: DeployFacts = {
    fixInBase: isAncestor(fix, base),
    fixInLive: isAncestor(fix, live),
    aheadCount: Number(git(["rev-list", "--count", live + ".." + base])),
  };
  const r = computeDeployVerdict(facts);
  console.log("=== inspect:prod-deploy ===");
  console.log("base ref: " + base + ", fix: " + fix + ", live: " + live);
  for (const ln of r.lines) console.log(ln);
  process.exit(r.exitCode);
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("inspect-prod-deploy.ts") || invoked.endsWith("inspect-prod-deploy.js")) {
  main();
}
