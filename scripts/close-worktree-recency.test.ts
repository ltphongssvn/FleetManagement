// scripts/close-worktree-recency.test.ts
// RED (worktree-close recency arc, 2026-07-28): a worktree can be ancestry-
// contained in origin/develop AND have a merged PR AND a clean tree AND no open
// PR -- yet still be the LIVE working directory a terminal is actively coding in
// right now, in the gap between one slice merging and the next being pushed.
// decideClose had no signal for this and would REMOVE such a worktree (near-miss
// observed 2026-07-28: t20-wt1-twelve-factor-audit, ahead=0, PR #440 merged, but
// its per-worktree HEAD reflog showed activity 1 hour prior).
//
// The 2026 liveness primitive is the per-worktree HEAD reflog recency, not fs
// mtime (which pnpm install / editor autosave / build artifacts corrupt). The
// driver computes idleHours from git reflog --date=unix -1; this pure core
// decides.
//
// FAIL-SAFE DEFAULT (Saltzer-Schroeder / arc42 safety interlock): the hazard is
// deleting live work, so when idle-time is UNKNOWN the safe state is RECENT
// (protect), never removable. Hence idleHours DEFAULTS TO 0 (recent): a caller
// that forgets to supply reflog data fails safe -- it refuses -- rather than
// fails open and deletes. Drivers always compute and pass the real idleHours, so
// the default only ever bites a future code path that omits the signal.
//
// recent is a LOSS-RISK guard: it refuses even when retired, because active work
// is active regardless of merge intent. It is the committed-about-to-continue
// complement to dirty (uncommitted work).
import { describe, it, expect } from "vitest";
import {
  decideClose,
  WorktreeCloseInputSchema,
  RECENT_IDLE_THRESHOLD_HOURS,
  type WorktreeCloseInput,
} from "./close-worktree.js";

const REMOVABLE: WorktreeCloseInput = {
  path: "/c/t20-twelve-factor",
  branch: "feature/twelve-factor-audit",
  hasUpstream: true,
  aheadOfRemote: 0,
  dirtyFileCount: 0,
  containedInIntegration: true,
  isPrimaryClone: false,
  retired: false,
  idleHours: 999,
};

describe("decideClose: recency guard protects active worktrees", () => {
  it("FAIL-SAFE: idleHours defaults to 0 (recent) when omitted", () => {
    const parsed = WorktreeCloseInputSchema.parse({
      path: "/p", branch: "b", hasUpstream: true, aheadOfRemote: 0,
      dirtyFileCount: 0, containedInIntegration: true, isPrimaryClone: false,
    });
    expect(parsed.idleHours).toBe(0);
  });

  it("FAIL-SAFE: a caller omitting idleHours REFUSES with recent, never deletes", () => {
    const v = decideClose(WorktreeCloseInputSchema.parse({
      path: "/p", branch: "b", hasUpstream: true, aheadOfRemote: 0,
      dirtyFileCount: 0, containedInIntegration: true, isPrimaryClone: false,
    }));
    expect(v.action).toBe("refuse");
    expect(v.reasons).toContain("recent");
  });

  it("removes a merged, clean, STALE worktree (idle past threshold)", () => {
    expect(decideClose(REMOVABLE).action).toBe("remove");
  });

  it("REFUSES a merged, clean worktree touched within the idle window", () => {
    const v = decideClose({ ...REMOVABLE, idleHours: 1 });
    expect(v.action).toBe("refuse");
    expect(v.reasons).toContain("recent");
  });

  it("recent refuses even a retired close (active work is active)", () => {
    const v = decideClose({ ...REMOVABLE, retired: true, containedInIntegration: false, idleHours: 2 });
    expect(v.action).toBe("refuse");
    expect(v.reasons).toContain("recent");
  });

  it("exactly at the threshold is NOT recent (boundary is strict <)", () => {
    const v = decideClose({ ...REMOVABLE, idleHours: RECENT_IDLE_THRESHOLD_HOURS });
    expect(v.action).toBe("remove");
  });

  it("reports recent alongside other loss-risk reasons at once", () => {
    const v = decideClose({ ...REMOVABLE, dirtyFileCount: 3, idleHours: 1 });
    expect(v.action).toBe("refuse");
    expect(v.reasons).toContain("recent");
    expect(v.reasons).toContain("dirty");
  });
});
