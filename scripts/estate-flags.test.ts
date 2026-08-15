// scripts/estate-flags.test.ts
// BOUNDED EXHAUSTIVE COVERAGE of the five flags a worktree can raise.
//
// THE GAP THIS CLOSES. The five flags were covered by five singles and one
// triple -- 6 of 32 combinations -- and not one of the six mixed a
// work-in-progress flag with a structural one. So STRUCTURAL DOMINATES, the
// rule that decides which remedy an operator is sent to, was proven only over
// SYNTHETIC reason arrays in estate-action.test.ts. The path a real worktree
// actually takes -- reasonsFor, classifyEstate, actionForVerdict, the emitted
// event -- had never been exercised on a mixed state at all.
//
// EXHAUSTIVE, NOT SAMPLED, and that is the stronger reading of "property-based"
// rather than a substitute for it. Five booleans are a Cartesian product of
// finite sets, which is the classical shape combinatorial coverage was defined
// for, and enumerating 2^5 = 32 rows IS property-based testing with an
// enumerative generator -- the SmallCheck and LeanCheck model, also called
// bounded exhaustive testing. A random generator would sample this space and
// report a percentage; walking it proves the space. NIST's finding that most
// faults come from one or two interacting parameters is exactly why the mixed
// pairs mattered and exactly why none of them was covered.
import { describe, it, expect } from 'vitest';
import {
  EstateEventSchema,
  classifyEstate,
  createWorktreeState,
  decideEstate,
  digestOf,
  estateDigest,
  estateTelemetry,
  reasonsFor,
  type EstateReason,
  type WorktreeState,
} from './estate-verify.js';
import { mayProceed } from './estate-action.js';

/** The five independent dimensions git reports, as booleans. The three counts
 *  are thresholds -- any positive value raises the flag -- so the boolean IS
 *  the dimension, and the value chosen below exercises the > 0 boundary. */
interface Flags {
  readonly dirty: boolean;
  readonly unpushed: boolean;
  readonly stash: boolean;
  readonly prunable: boolean;
  readonly locked: boolean;
}

/** All 2^5 = 32 combinations, generated rather than hand-listed: a hand-listed
 *  table is a second declaration of the vocabulary and would be the very drift
 *  this arc keeps removing. */
const FLAG_COMBINATIONS: readonly Flags[] = Object.freeze(
  Array.from({ length: 32 }, (_unused, mask) => ({
    dirty: (mask & 1) !== 0,
    unpushed: (mask & 2) !== 0,
    stash: (mask & 4) !== 0,
    prunable: (mask & 8) !== 0,
    locked: (mask & 16) !== 0,
  })),
);

function stateFor(flags: Flags, path = '/c/a'): WorktreeState {
  return createWorktreeState({
    path,
    branch: 'feat/x',
    // A count of 1 sits exactly on the > 0 boundary the classifier tests.
    dirtyFileCount: flags.dirty ? 1 : 0,
    aheadOfRemote: flags.unpushed ? 1 : 0,
    stashCount: flags.stash ? 1 : 0,
    prunable: flags.prunable,
    locked: flags.locked,
  });
}

/** The reasons a combination SHOULD raise, derived independently of the code
 *  under test and in ESTATE_REASONS declaration order. Written out rather than
 *  computed from the implementation, so the test is an oracle and not a mirror. */
function expectedReasons(flags: Flags): readonly EstateReason[] {
  const out: EstateReason[] = [];
  if (flags.dirty) out.push('dirty');
  if (flags.unpushed) out.push('unpushed');
  if (flags.stash) out.push('stash');
  if (flags.prunable) out.push('prunable');
  if (flags.locked) out.push('locked');
  return out;
}

const SRC = digestOf('worktree /c/a');

describe('ALL 32 combinations of the five flags', () => {
  it('enumerates the whole space, not a sample of it', () => {
    expect(FLAG_COMBINATIONS).toHaveLength(32);
    expect(new Set(FLAG_COMBINATIONS.map((f) => JSON.stringify(f))).size).toBe(32);
  });

  it('raises exactly the reasons its flags name, in declaration order', () => {
    for (const flags of FLAG_COMBINATIONS) {
      expect(reasonsFor(stateFor(flags))).toEqual(expectedReasons(flags));
    }
  });

  // INDEPENDENCE. NIST's result is that most faults come from one or two
  // interacting parameters, so the property worth stating is that there are NO
  // interactions here: each flag contributes its own reason and nothing else,
  // whatever the other four are doing.
  it('lets each flag contribute its reason regardless of the other four', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const raised = reasonsFor(stateFor(flags));
      expect(raised.includes('dirty')).toBe(flags.dirty);
      expect(raised.includes('unpushed')).toBe(flags.unpushed);
      expect(raised.includes('stash')).toBe(flags.stash);
      expect(raised.includes('prunable')).toBe(flags.prunable);
      expect(raised.includes('locked')).toBe(flags.locked);
    }
  });

  it('is clean for exactly the one combination that raises nothing', () => {
    const clean = FLAG_COMBINATIONS.filter((f) => classifyEstate([stateFor(f)]).clean);
    expect(clean).toHaveLength(1);
    for (const f of clean) {
      expect(reasonsFor(stateFor(f))).toEqual([]);
    }
  });

  it('never raises a reason no flag asked for', () => {
    for (const flags of FLAG_COMBINATIONS) {
      expect(reasonsFor(stateFor(flags)).length).toBe(expectedReasons(flags).length);
    }
  });

  it('never repeats a reason', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const raised = reasonsFor(stateFor(flags));
      expect(new Set(raised).size).toBe(raised.length);
    }
  });
});

// THE UNCOVERED HALF. Every combination that mixes a work-in-progress flag with
// a structural one -- and there are twenty-four of them -- had never reached
// the action policy through a real worktree state.
describe('the end-to-end path, over every combination', () => {
  function actionFor(flags: Flags): string {
    const d = decideEstate({ kind: 'states', states: [stateFor(flags)], sourceDigest: SRC });
    return d.event.agent_action;
  }

  it('recommends PROCEED only when no flag is raised', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const proceeds = actionFor(flags) === 'PROCEED';
      expect(proceeds).toBe(expectedReasons(flags).length === 0);
    }
  });

  // STRUCTURAL DOMINATES, now proven where it is actually decided: a worktree
  // whose gitdir points nowhere cannot have work finished inside it, so
  // reporting work-in-progress would send the operator to a remedy that cannot
  // run. Twenty-four of these combinations are the mixed cases that had no
  // coverage at all.
  it('reports STRUCTURAL whenever prunable or locked is raised, mixed or not', () => {
    for (const flags of FLAG_COMBINATIONS) {
      if (!flags.prunable && !flags.locked) continue;
      expect(actionFor(flags)).toBe('HALT_STRUCTURAL');
    }
  });

  it('reports WORK_IN_PROGRESS only when every raised flag is the operator\u2019s', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const wipOnly = !flags.prunable && !flags.locked
        && (flags.dirty || flags.unpushed || flags.stash);
      if (!wipOnly) continue;
      expect(actionFor(flags)).toBe('HALT_WORK_IN_PROGRESS');
    }
  });

  // The session-closed contract, over the entire space rather than an example.
  it('NEVER permits proceeding while any flag remains raised', () => {
    for (const flags of FLAG_COMBINATIONS) {
      if (expectedReasons(flags).length === 0) continue;
      expect(mayProceed(actionFor(flags) as never)).toBe(false);
    }
  });

  it('exits 0 for the clean combination and 1 for every other', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const d = decideEstate({ kind: 'states', states: [stateFor(flags)], sourceDigest: SRC });
      expect(d.exitCode).toBe(expectedReasons(flags).length === 0 ? 0 : 1);
    }
  });
});

describe('the emitted event, over every combination', () => {
  it('carries exactly the raised reasons', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const state = stateFor(flags);
      const e = estateTelemetry(classifyEstate([state]), null, estateDigest([state]));
      expect(e.attributes.reasons).toEqual(expectedReasons(flags));
    }
  });

  it('carries both kinds exactly when both are present', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const state = stateFor(flags);
      const e = estateTelemetry(classifyEstate([state]), null, estateDigest([state]));
      const hasWip = flags.dirty || flags.unpushed || flags.stash;
      const hasStructural = flags.prunable || flags.locked;
      expect(e.attributes.kinds.includes('work-in-progress')).toBe(hasWip);
      expect(e.attributes.kinds.includes('structural')).toBe(hasStructural);
    }
  });

  // Every one of the 32 must satisfy the published contract, not just the ones
  // someone thought to construct by hand.
  it('parses against the published contract for every combination', () => {
    for (const flags of FLAG_COMBINATIONS) {
      const state = stateFor(flags);
      const e = estateTelemetry(classifyEstate([state]), null, estateDigest([state]));
      expect(EstateEventSchema.safeParse(e).success).toBe(true);
    }
  });

  // Distinct states must be distinctly addressable, or --expect-digest would
  // accept a plan made against a different worktree.
  it('gives every combination a distinct estate digest', () => {
    const digests = FLAG_COMBINATIONS.map((f) => estateDigest([stateFor(f)]));
    expect(new Set(digests).size).toBe(32);
  });
});
