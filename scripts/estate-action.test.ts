// scripts/estate-action.test.ts
// The contract an ORCHESTRATOR consumes: what may this caller do next.
//
// WHY THIS EXISTS. estate:verify reported observations and left the rule "never
// declare the session closed while a problem remains" in the task description,
// where an agent has to read English to find it. The exit code carries that
// rule but reaches only a process parent; an agent reading the NDJSON stream
// off a collector saw no such field.
//
// EXHAUSTIVE, NOT SAMPLED. Five reasons yield 32 subsets, so every combination
// of defects is enumerated here rather than drawn at random. A property-based
// generator would sample this space; enumerating it proves the space. Random
// generation earns its keep where the input space is too large to walk -- this
// one is 32 rows and walking it is both cheaper and complete.
import { describe, it, expect } from 'vitest';
import {
  ACTION_EXIT,
  ESTATE_ACTIONS,
  actionForReasons,
  actionForVerdict,
  exitCodeFor,
  mayProceed,
  type EstateAction,
} from './estate-action.js';
import { ESTATE_REASONS, REASON_KIND, type EstateReason } from './estate-verify.js';

/** Every subset of the reason vocabulary, in a stable order. */
function subsets<T>(xs: readonly T[]): T[][] {
  return xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);
}

const ALL_SUBSETS = subsets(ESTATE_REASONS);

describe('the action vocabulary', () => {
  it('names five distinct actions', () => {
    expect(new Set(ESTATE_ACTIONS).size).toBe(ESTATE_ACTIONS.length);
    expect(ESTATE_ACTIONS).toHaveLength(5);
  });

  it('gives every action an exit code', () => {
    for (const action of ESTATE_ACTIONS) {
      expect(typeof ACTION_EXIT[action]).toBe('number');
    }
  });

  // The codes are the graded exits the task documents. Both channels read from
  // this one map, so they cannot disagree.
  it('maps actions onto the documented graded exits', () => {
    expect(exitCodeFor('PROCEED')).toBe(0);
    expect(exitCodeFor('HALT_WORK_IN_PROGRESS')).toBe(1);
    expect(exitCodeFor('HALT_STRUCTURAL')).toBe(1);
    expect(exitCodeFor('REPAIR_TOOLING')).toBe(3);
    expect(exitCodeFor('REREAD_ESTATE')).toBe(4);
  });

  it('exits ZERO for exactly one action', () => {
    const zero = ESTATE_ACTIONS.filter((a) => exitCodeFor(a) === 0);
    expect(zero).toEqual(['PROCEED']);
  });
});

describe('mayProceed is the session-closed contract', () => {
  it('permits proceeding only when nothing is in flight', () => {
    expect(mayProceed('PROCEED')).toBe(true);
  });

  // THE CRITIQUE'S CENTRAL ASSERTION: an agent must never declare the session
  // closed while any problem remains.
  it('FORBIDS proceeding for every non-clean action', () => {
    for (const action of ESTATE_ACTIONS) {
      if (action === 'PROCEED') continue;
      expect(mayProceed(action)).toBe(false);
    }
  });

  // The predicate and the exit code must never disagree: a caller branching on
  // one and a collector branching on the other would take different paths.
  it('agrees with the exit code for every action', () => {
    for (const action of ESTATE_ACTIONS) {
      expect(mayProceed(action)).toBe(exitCodeFor(action) === 0);
    }
  });
});

describe('actionForReasons over ALL 32 combinations of defects', () => {
  it('enumerates the whole space, not a sample', () => {
    expect(ALL_SUBSETS).toHaveLength(32);
  });

  it('permits proceeding for exactly the empty combination', () => {
    const proceeding = ALL_SUBSETS.filter((s) => actionForReasons(s) === 'PROCEED');
    expect(proceeding).toEqual([[]]);
  });

  // The contract stated as an invariant over the entire space.
  it('NEVER permits proceeding while any reason remains', () => {
    for (const reasons of ALL_SUBSETS) {
      if (reasons.length === 0) continue;
      expect(mayProceed(actionForReasons(reasons))).toBe(false);
    }
  });

  it('returns a member of the vocabulary for every combination', () => {
    for (const reasons of ALL_SUBSETS) {
      expect(ESTATE_ACTIONS).toContain(actionForReasons(reasons));
    }
  });

  // STRUCTURAL DOMINATES: a worktree that is both dirty and prunable needs the
  // git repair first, because finishing work inside a worktree whose gitdir
  // points nowhere is not possible.
  it('reports STRUCTURAL whenever any structural reason is present', () => {
    for (const reasons of ALL_SUBSETS) {
      const hasStructural = reasons.some((r) => REASON_KIND[r] === 'structural');
      if (!hasStructural) continue;
      expect(actionForReasons(reasons)).toBe('HALT_STRUCTURAL');
    }
  });

  it('reports WORK_IN_PROGRESS only when every reason is the operator\u2019s', () => {
    for (const reasons of ALL_SUBSETS) {
      if (reasons.length === 0) continue;
      const allWip = reasons.every((r) => REASON_KIND[r] === 'work-in-progress');
      if (!allWip) continue;
      expect(actionForReasons(reasons)).toBe('HALT_WORK_IN_PROGRESS');
    }
  });

  // Order comes from git's walk and is not a property of the estate.
  it('is independent of the order the reasons arrive in', () => {
    for (const reasons of ALL_SUBSETS) {
      expect(actionForReasons([...reasons].reverse())).toBe(actionForReasons(reasons));
    }
  });

  it('is idempotent -- the same combination always yields the same action', () => {
    for (const reasons of ALL_SUBSETS) {
      expect(actionForReasons(reasons)).toBe(actionForReasons(reasons));
    }
  });

  it('ignores repeats, since a reason present twice is present once', () => {
    for (const reasons of ALL_SUBSETS) {
      expect(actionForReasons([...reasons, ...reasons])).toBe(actionForReasons(reasons));
    }
  });

  // Every single reason on its own must map to the kind it is classified as,
  // or the taxonomy and the policy have drifted.
  it('maps each individual reason to the halt its kind implies', () => {
    for (const reason of ESTATE_REASONS) {
      const expected: EstateAction =
        REASON_KIND[reason] === 'structural' ? 'HALT_STRUCTURAL' : 'HALT_WORK_IN_PROGRESS';
      expect(actionForReasons([reason])).toBe(expected);
    }
  });
});

describe('actionForVerdict', () => {
  it('agrees with actionForReasons across the whole space', () => {
    for (const reasons of ALL_SUBSETS) {
      expect(actionForVerdict(reasons)).toBe(actionForReasons(reasons));
    }
  });

  it('permits proceeding on a clean estate', () => {
    expect(actionForVerdict([])).toBe('PROCEED');
    expect(mayProceed(actionForVerdict([]))).toBe(true);
  });

  it('refuses on a mixed estate, reporting the structural remedy', () => {
    const mixed: readonly EstateReason[] = ['dirty', 'locked'];
    expect(actionForVerdict(mixed)).toBe('HALT_STRUCTURAL');
    expect(mayProceed(actionForVerdict(mixed))).toBe(false);
  });
});
