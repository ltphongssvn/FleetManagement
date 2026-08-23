// scripts/sweep-worktrees.test.ts
// RED (worktree-sweep arc slice 1): the estate has 50+ worktrees; closing
// each merged one by hand is not rediscoverable and races under concurrency.
// sweep is the batch orchestrator over the existing worktree:close primitive.
// This slice pins the PURE planner: given the porcelain-parsed worktree
// entries, it returns the ordered list of candidate paths to ATTEMPT a close
// on -- it must NOT itself decide merged-vs-unmerged (that snapshot races; the
// per-candidate decideClose is the authority). planSweep only excludes what
// can never be a candidate: the primary clone and any protected paths.
//
// Contract pinned here:
//  * the primary clone (entries[0]) is NEVER a candidate;
//  * protectedPaths are excluded (caller-supplied opt-out, e.g. WT3 mirror);
//  * order is preserved (deterministic operator report);
//  * no git, no fs -- pure over the parsed entries;
//  * input is Zod-parsed at the boundary (mirrors close-worktree.ts).
import { describe, it, expect } from 'vitest';
import { planSweep, SweepInputSchema, type SweepInput } from './sweep-worktrees.js';

const PRIMARY = '/home/u/code/FleetManagement';
const WT3 = '/home/u/code/FleetManagement-WT3';
const T7 = '/home/u/code/t7-wt1-device-binding';
const T18 = '/home/u/code/t18-wt1-board-cargo-diff';

const ENTRIES = [
  { path: PRIMARY, branch: 'develop' },
  { path: WT3, branch: 'develop' },
  { path: T7, branch: 'feature/device-binding' },
  { path: T18, branch: 'feature/board-cargo-diff' },
];

describe('planSweep: candidate selection is pure and delegates the verdict', () => {
  it('excludes the primary clone (entries[0]) always', () => {
    const plan = planSweep({ entries: ENTRIES, protectedPaths: [] });
    expect(plan.candidates).not.toContain(PRIMARY);
  });

  it('returns every non-primary path when nothing is protected', () => {
    const plan = planSweep({ entries: ENTRIES, protectedPaths: [] });
    expect(plan.candidates).toEqual([WT3, T7, T18]);
  });

  it('excludes explicitly protected paths (e.g. the WT3 develop mirror)', () => {
    const plan = planSweep({ entries: ENTRIES, protectedPaths: [WT3] });
    expect(plan.candidates).toEqual([T7, T18]);
  });

  it('preserves entry order for a deterministic operator report', () => {
    const plan = planSweep({ entries: ENTRIES, protectedPaths: [] });
    expect(plan.candidates[0]).toBe(WT3);
  });

  it('does NOT pre-decide merged status -- candidates is purely path selection', () => {
    const plan = planSweep({ entries: ENTRIES, protectedPaths: [] });
    expect(Object.keys(plan)).toEqual(['candidates']);
  });

  it('Zod-parses the boundary: entries required, protectedPaths defaults []', () => {
    const parsed: SweepInput = SweepInputSchema.parse({ entries: ENTRIES });
    expect(parsed.protectedPaths).toEqual([]);
  });

  it('an estate of only the primary yields no candidates', () => {
    const plan = planSweep({ entries: [{ path: PRIMARY, branch: 'develop' }], protectedPaths: [] });
    expect(plan.candidates).toEqual([]);
  });
});
