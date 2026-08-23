// scripts/sweep-worktrees.ts
// GREEN (worktree-sweep arc slice 1): pure candidate planner for the batch
// worktree sweep. Captured as a root script because closing 50+ merged
// worktrees by hand is not rediscoverable and races under concurrency.
// Purity: no child_process, no fs, no git. The caller gathers the porcelain
// worktree list and passes parsed entries in; this module only selects WHICH
// paths to attempt a close on. It deliberately does NOT decide merged-vs-
// unmerged: that snapshot races against concurrent pushes across the estate,
// so the authority is the per-candidate decideClose (slice 2 driver), whose
// guards refuse anything unmerged/dirty/ahead at the moment of the attempt.
// planSweep only removes what can never be a candidate: the primary clone
// (index 0) and any caller-supplied protected paths (e.g. the WT3 mirror).
// Mirrors the close-worktree.ts precedent: Zod at the boundary, pure verdict.

import { z } from 'zod';

export const SweepEntrySchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
});

export const SweepInputSchema = z.object({
  entries: z.array(SweepEntrySchema),
  protectedPaths: z.array(z.string()).default([]),
});

export type SweepInput = z.infer<typeof SweepInputSchema>;

export interface SweepPlan {
  candidates: string[];
}

// Pure: excludes entries[0] (primary clone) and any protectedPaths, preserves
// order. No mergedness decision here -- decideClose owns the verdict per path.
export function planSweep(raw: SweepInput): SweepPlan {
  const input = SweepInputSchema.parse(raw);
  const primary = input.entries[0]?.path;
  const blocked = new Set(input.protectedPaths);
  if (primary !== undefined) blocked.add(primary);
  const candidates = input.entries.map((e) => e.path).filter((p) => !blocked.has(p));
  return { candidates };
}
