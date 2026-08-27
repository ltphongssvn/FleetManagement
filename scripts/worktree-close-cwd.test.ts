// scripts/worktree-close-cwd.test.ts
// THE HALF-COMPLETED CLOSE, made reachable.
//
// WHAT HAPPENED, 2026-08-18. `worktree:close -- <path> --done` was invoked from
// INSIDE the worktree it was closing, which is the normal case at the end of a
// session. The plan is two commands:
//
//   git worktree remove <path>
//   git branch -D <branch>
//
// Both ran with NO cwd, so both inherited process.cwd(). The first deleted that
// directory; the second died with
//
//   fatal: Unable to read current working directory: No such file or directory
//
// The worktree was gone, the branch survived, and the task exited 1 with a node
// stack trace -- AFTER the report had already printed "verdict: remove". A
// close that reports success and completes halfway is worse than one that
// refuses, because `git worktree list` afterwards looks correct: the removal
// really did succeed, and only the orphaned branch remains to be tripped over
// later.
//
// WHY NO TEST CAUGHT IT. There was no value to test. The cwd was the ABSENCE of
// an argument -- `git(cmd.slice(1))` with the parameter omitted -- inside a
// main() under a v8-ignore. A decision expressed as an omission cannot be
// asserted, which is the same shape as the eight-hour audit hang: the branch
// existed only as control flow nobody could reach.
//
// So the choice became planCwd, a pure function over the worktree list. These
// tests pin the property that matters: whatever it returns must SURVIVE the
// removal of the target.
import { describe, it, expect } from 'vitest';
import { planCwd } from './worktree-close-cli.js';
import type { WorktreeEntry } from './worktree-close.js';

const PRIMARY = '/Users/dev/code/FleetManagement';
const TARGET = '/Users/dev/code/t116-wt1-estate-verify';
const OTHER = '/Users/dev/code/t118-wt1-roster';

function entry(path: string, branch: string): WorktreeEntry {
  return { path, branch };
}

const ESTATE: readonly WorktreeEntry[] = [
  entry(PRIMARY, 'develop'),
  entry(TARGET, 'feat/estate-verify'),
  entry(OTHER, 'chore/roster'),
];

describe('planCwd: the plan runs somewhere that survives the removal', () => {
  // THE OBSERVED FAILURE, inverted. Returning the target is what the omitted
  // cwd effectively did whenever the operator ran the task from inside it.
  it('NEVER returns the worktree being removed', () => {
    expect(planCwd(ESTATE, TARGET)).not.toBe(TARGET);
  });

  // `git worktree list --porcelain` always lists the primary clone first, and
  // decideClose refuses `primary-clone` -- so this directory cannot be the one
  // the plan deletes. Safe by construction, not by luck.
  it('returns the PRIMARY clone, which decideClose can never close', () => {
    expect(planCwd(ESTATE, TARGET)).toBe(PRIMARY);
  });

  // The choice must not depend on which worktree is being closed, or a future
  // caller closing the second-listed one would get a different answer.
  it('returns the same directory whichever worktree is the target', () => {
    expect(planCwd(ESTATE, OTHER)).toBe(planCwd(ESTATE, TARGET));
  });

  it('is stable across repeated calls', () => {
    expect(planCwd(ESTATE, TARGET)).toBe(planCwd(ESTATE, TARGET));
  });
});

describe('planCwd: degenerate estates still yield a surviving directory', () => {
  // An empty list should not happen -- git lists at least the primary -- but a
  // close that throws on the fallback path would leave the SAME half-completed
  // state this fix exists to prevent.
  it('falls back to the target PARENT when the list is empty', () => {
    expect(planCwd([], TARGET)).toBe('/Users/dev/code');
  });

  // The parent outlives the removal of the child, which is the only property
  // required of a fallback.
  it('the fallback is not the target itself', () => {
    expect(planCwd([], TARGET)).not.toBe(TARGET);
  });

  // A single-entry estate means the target IS the primary; decideClose refuses
  // that outright, so the plan never runs -- but planCwd must still answer with
  // something rather than throwing, since a throw here would be indistinguish-
  // able from the crash it replaces.
  it('answers without throwing when the estate holds only one entry', () => {
    expect(planCwd([entry(PRIMARY, 'develop')], PRIMARY)).toBe(PRIMARY);
  });

  it('answers without throwing for a target that is not in the list', () => {
    expect(planCwd(ESTATE, '/Users/dev/code/t999-unknown')).toBe(PRIMARY);
  });

  // Trailing separators come from tab-completion; resolve() normalises them, so
  // the fallback must not produce a different directory for the same worktree.
  it('normalises a trailing separator in the fallback path', () => {
    expect(planCwd([], TARGET + '/')).toBe('/Users/dev/code');
  });
});
