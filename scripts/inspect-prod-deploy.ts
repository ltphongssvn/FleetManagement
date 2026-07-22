// File: FleetManagement/scripts/inspect-prod-deploy.ts
//
// Read-only diagnostic: does the LIVE prod deploy actually contain a given
// fix commit, and is that fix promoted to the base branch? Pure git/deploy
// ledger read -- NO workspace package, NO DB, NO build. Mirrors the
// audit:ci-minutes root-task shape (ledger read + non-zero exit past a
// threshold). computeDeployVerdict is the pure, unit-tested core; the git
// driver only resolves ancestry facts and feeds them in.
//
// Run: pnpm exec turbo run inspect:prod-deploy -- --fix <sha> [--base <ref>] \\
//        (--live <sha> | --live-url <url>)
// --live-url fetches the deploy commit from a /health/version endpoint, so the
// running app self-reports its SHA instead of an operator copying a build id.

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


// --- live-ref resolution: ask prod which commit it runs (ends tile-hash guessing) ---
export function looksLikeUrl(v: string): boolean {
  return v.startsWith("http://") || v.startsWith("https://");
}

export function parseShaFromVersionPayload(body: string): string {
  const data = JSON.parse(body) as { sha?: unknown };
  const sha = typeof data.sha === "string" ? data.sha : "";
  if (sha === "" || sha === "unknown") {
    throw new Error("version endpoint returned no usable sha (got: " + String((data as { sha?: unknown }).sha) + ")");
  }
  return sha;
}

export async function resolveLiveRef(live: string): Promise<string> {
  if (!looksLikeUrl(live)) return live;
  const res = await fetch(live);
  if (!res.ok) throw new Error("version endpoint HTTP " + String(res.status) + " at " + live);
  return parseShaFromVersionPayload(await res.text());
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const liveUrl = arg("--live-url", argv);
  const liveArg = arg("--live", argv);
  const fix = arg("--fix", argv);
  const base = arg("--base", argv) ?? "origin/main";
  if ((!liveArg && !liveUrl) || !fix) {
    console.error("usage: inspect:prod-deploy -- (--live <sha> | --live-url <url>) --fix <sha> [--base <ref>]");
    process.exit(2);
  }
  const live = await resolveLiveRef(liveUrl ?? (liveArg as string));
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
  void main();
}
