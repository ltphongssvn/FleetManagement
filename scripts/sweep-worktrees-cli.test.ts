// scripts/sweep-worktrees-cli.test.ts
// RED->GREEN (worktree-sweep arc slice 2): pins the driver pure parts so the
// batch op is reachable and auditable without spawning git. The driver composes
// planSweep with the EXISTING worktree:close pipeline (decideClose/closePlan/
// resolveCloseInput imported verbatim), so a sweep close cannot bypass the
// per-candidate guards. main() runs ONLY as entrypoint. Precedent: slice 3 of
// worktree-close-cli.ts.
import { describe, it, expect } from "vitest";
import {
  parseSweepArgv,
  formatSweepSummary,
  protectedIntegrationPaths,
  PROTECTED_INTEGRATION_BRANCHES,
  withBranch,
  type SweepOutcome,
} from "./sweep-worktrees-cli.js";
import { planSweep } from "./sweep-worktrees.js";

describe("parseSweepArgv: pure flag parsing", () => {
  it("defaults every flag to false with no arguments", () => {
    expect(parseSweepArgv([])).toEqual({ dryRun: false, done: false });
  });

  it("reads --dry-run", () => {
    expect(parseSweepArgv(["--dry-run"])).toEqual({ dryRun: true, done: false });
  });

  // The third case here USED to assert `ignores unknown -- flags`. It was
  // deleted rather than repaired: it pinned the exact behaviour this arc
  // reverses. A swallowed --dry-runn produced a confident, wrong verdict
  // indistinguishable from a real sweep, which is how `--done` was accepted and
  // silently discarded across eight worktrees. Strictness is asserted below.
});

describe("protectedIntegrationPaths: never sweep the integration mirrors", () => {
  const ENTRIES = [
    { path: "/c/FleetManagement", branch: "develop" },
    { path: "/c/FleetManagement-WT3", branch: "develop" },
    { path: "/c/FM-main-mirror", branch: "main" },
    { path: "/c/t7-device-binding", branch: "feature/device-binding" },
  ];

  it("protects every develop/main worktree by branch identity", () => {
    expect(protectedIntegrationPaths(ENTRIES)).toEqual([
      "/c/FleetManagement",
      "/c/FleetManagement-WT3",
      "/c/FM-main-mirror",
    ]);
  });

  it("never protects a feature-branch worktree", () => {
    expect(protectedIntegrationPaths(ENTRIES)).not.toContain("/c/t7-device-binding");
  });

  it("covers the 2026 protected-branch convention set", () => {
    for (const b of ["main", "master", "develop", "staging", "production"]) {
      expect(PROTECTED_INTEGRATION_BRANCHES.has(b)).toBe(true);
    }
  });
});

describe("formatSweepSummary: auditable operator report", () => {
  const OUTCOMES: SweepOutcome[] = [
    { path: "/c/t7", action: "remove", reasons: [] },
    { path: "/c/t18", action: "remove", reasons: [] },
    { path: "/c/t6", action: "refuse", reasons: ["unpushed"] },
    { path: "/c/t4", action: "remove-keep-branch", reasons: [] },
  ];

  it("counts removed, refused, and kept in the footer", () => {
    const out = formatSweepSummary(OUTCOMES);
    expect(out).toContain("removed=2");
    expect(out).toContain("refused=1");
    expect(out).toContain("kept=1");
  });

  it("shows the refusal reason next to the refused worktree", () => {
    const out = formatSweepSummary(OUTCOMES);
    expect(out).toContain("t6");
    expect(out).toContain("unpushed");
  });

  it("an empty run reports all-zero totals", () => {
    const out = formatSweepSummary([]);
    expect(out).toContain("removed=0");
    expect(out).toContain("refused=0");
    expect(out).toContain("kept=0");
  });
});

// ---------------------------------------------------------------------------
// Detached worktrees.
//
// git worktree list --porcelain reports a detached worktree with NO branch line,
// so parseWorktreePorcelain yields branch: null -- WorktreeEntry declares
// branch: string | null for exactly this case. But SweepEntrySchema requires
// branch: z.string().min(1) and planSweep PARSES its input, so handing entries
// straight through makes the whole sweep THROW the moment one detached worktree
// exists anywhere in the estate. Two type errors reported this
// (sweep-worktrees-cli.ts:156 and :157) and nothing caught them, because
// scripts/ had never been typechecked.
//
// Fixed by parsing at the boundary rather than validating downstream: a type
// guard narrows WorktreeEntry to WorktreeBranchEntry, and a detached worktree is
// filtered out before it can become a candidate. It is not a cast -- a cast
// would silence the compiler and keep the runtime throw.
//
// Excluding them is also correct on the merits, not merely convenient: a
// detached worktree has no branch to delete and no upstream to compare, so every
// close guard that reasons about a branch is meaningless for it. Today it is
// caught downstream by the no-upstream refusal, which is defence in depth
// working by accident. This makes the exclusion deliberate.
describe("withBranch: detached worktrees never enter the sweep", () => {
  const MIXED = [
    { path: "/c/FleetManagement", branch: "develop" },
    { path: "/c/t7-device-binding", branch: "feature/device-binding" },
    { path: "/c/detached-bisect", branch: null },
  ];

  it("drops the detached entry and keeps the rest", () => {
    expect(withBranch(MIXED)).toEqual([
      { path: "/c/FleetManagement", branch: "develop" },
      { path: "/c/t7-device-binding", branch: "feature/device-binding" },
    ]);
  });

  it("returns an empty list when every worktree is detached", () => {
    expect(withBranch([{ path: "/c/a", branch: null }])).toEqual([]);
  });

  it("is a pass-through when nothing is detached", () => {
    const all = [{ path: "/c/a", branch: "x" }];
    expect(withBranch(all)).toEqual(all);
  });

  it("protectedIntegrationPaths accepts its output without a cast", () => {
    expect(protectedIntegrationPaths(withBranch(MIXED))).toEqual([
      "/c/FleetManagement",
    ]);
  });

  it("planSweep parses the filtered entries instead of throwing", () => {
    // entries[0] is the primary clone and is always excluded by planSweep.
    expect(() => planSweep({ entries: withBranch(MIXED), protectedPaths: [] })).not.toThrow();
    expect(planSweep({ entries: withBranch(MIXED), protectedPaths: [] }).candidates)
      .toEqual(["/c/t7-device-binding"]);
  });

  it("planSweep THROWS on an unfiltered detached entry -- the bug this prevents", () => {
    const unfiltered = MIXED as unknown as { path: string; branch: string }[];
    expect(() => planSweep({ entries: unfiltered, protectedPaths: [] })).toThrow();
  });
});

// ---- --done must reach the batch path, and typos must not be swallowed ----
// worktree:close gained --done (recencyWaived = done AND containedInIntegration)
// so a FINISHED session can be reclaimed without waiting out 24 hours. The batch
// path never got it: parseSweepArgv recognised only --dry-run, and sweepOne
// never passed `done` to resolveCloseInput.
//
// Observed: eight worktrees, every PR merged and deployed, containment verified
// by hand for two of them -- and `worktree:sweep -- --done --dry-run` still
// refused them on `recent`. The flag was accepted and discarded.
//
// The deeper defect is that it was accepted at all. The old loop ignored every
// unrecognised flag by design ("unknown -- flags are ignored"), so --dry-runn or
// --exceute would produce a confident, wrong verdict indistinguishable from a
// real one. deps-reconcile-cli.ts already states the rule this file missed:
// strict parsing is the default so "a swallowed --exceute would otherwise
// produce a confident no-op the operator reads as a successful run".
describe('parseSweepArgv: --done and strictness', () => {
  it('parses --done', () => {
    expect(parseSweepArgv(['--done']).done).toBe(true);
  });

  it('defaults done to false', () => {
    expect(parseSweepArgv([]).done).toBe(false);
  });

  it('parses --done and --dry-run together, order-independent', () => {
    const a = parseSweepArgv(['--done', '--dry-run']);
    expect(a.done && a.dryRun).toBe(true);
    const b = parseSweepArgv(['--dry-run', '--done']);
    expect(b.done && b.dryRun).toBe(true);
  });

  // The typo that would otherwise read as a successful sweep.
  it('THROWS on an unknown flag instead of ignoring it', () => {
    expect(() => parseSweepArgv(['--dry-runn'])).toThrow();
    expect(() => parseSweepArgv(['--donee'])).toThrow();
  });

  it('still parses the known flags after adding strictness', () => {
    expect(parseSweepArgv(['--dry-run']).dryRun).toBe(true);
  });
});
