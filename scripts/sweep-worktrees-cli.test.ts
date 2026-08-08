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
  type SweepOutcome,
} from "./sweep-worktrees-cli.js";

describe("parseSweepArgv: pure flag parsing", () => {
  it("defaults dryRun to false with no flags", () => {
    expect(parseSweepArgv([])).toEqual({ dryRun: false });
  });

  it("reads --dry-run", () => {
    expect(parseSweepArgv(["--dry-run"])).toEqual({ dryRun: true });
  });

  it("ignores unknown -- flags", () => {
    expect(parseSweepArgv(["--wat"])).toEqual({ dryRun: false });
  });
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
