// scripts/estate-flags.test.ts
// BOUNDED EXHAUSTIVE COVERAGE over every combination of reasons a worktree can
// raise -- DERIVED from the vocabulary, never re-declared beside it.
//
// THE GAP THIS CLOSES. The previous revision hand-wrote a five-field Flags
// interface, hardcoded 32, and hand-wrote the expected reason list: three
// second declarations of ESTATE_REASONS. Adding a sixth reason would have
// produced a compile error in REASON_KIND and NOWHERE ELSE -- reasonsFor is an
// if-chain that simply would not set it, and this file would have gone on
// reporting "all 32 combinations" while covering half the space and calling it
// exhaustive. A test that lies about its own completeness is worse than one
// that admits a gap.
//
// WHY NOT GREP THE ASSERTIONS. A gate that scans this file for toContain or
// toEqual mentioning each reason proves a STRING APPEARS -- weaker than line
// coverage, which at least proves execution, and 2026 practice is blunt that
// even coverage is a weak proxy: "a test that runs a function but never checks
// its output contributes to coverage while verifying nothing", and what matters
// is "whether the tests would have NOTICED if the code behaved differently".
// expect(['dirty']).toContain('dirty') would satisfy a text gate and test
// nothing. Deriving the cases from the vocabulary is strictly stronger: a new
// reason changes the SIZE of the space, and the assertions below then fail
// unless the implementation really raises it.
//
// RAISE_REASON is the one thing that cannot be derived -- how to make git report
// each reason -- so it is a TOTAL Record. A new reason without a way to raise it
// is a COMPILE error, which is the same discipline REASON_KIND uses.
//
// EXHAUSTIVE, NOT SAMPLED. Booleans over a fixed vocabulary are a Cartesian
// product of finite sets, the classical shape combinatorial coverage was defined
// for, and enumerating 2^N IS property-based testing with an enumerative
// generator -- the SmallCheck model, also called bounded exhaustive testing. A
// random generator samples this space and reports a percentage; walking it
// proves the space.
//
// THE DECIDER TAKES AN OBSERVATION EVENT now, so these cases go through
// observedFixture -- which parses against the same schema production does. A
// {kind:'states'} literal could express an input observeEstate could never
// produce; a fixture that parses cannot.
import { describe, it, expect } from 'vitest';
import {
  ESTATE_REASONS,
  EstateEventSchema,
  REASON_KIND,
  TimestampSchema,
  classifyEstate,
  createWorktreeState,
  decideEstate,
  digestOf,
  estateDigest,
  estateTelemetry,
  observedFixture,
  reasonsFor,
  type EstateReason,
  type WorktreeState,
} from './estate-verify.js';
import { mayProceed } from './estate-action.js';

/** How to make a worktree raise each reason. TOTAL over the vocabulary, so a
 *  new reason cannot be added without stating how to produce it -- the only
 *  hand-written mapping here, and a compile error when it falls behind.
 *
 *  The counts use 1, which sits exactly on the > 0 boundary the classifier
 *  tests, so the boundary is exercised by every combination rather than by a
 *  separate case someone has to remember. */
const RAISE_REASON: Readonly<Record<EstateReason, Partial<WorktreeState>>> = Object.freeze({
  dirty: { dirtyFileCount: 1 },
  unpushed: { aheadOfRemote: 1 },
  stash: { stashCount: 1 },
  prunable: { prunable: true },
  locked: { locked: true },
});

/** 2^N, derived. A sixth reason makes this 64 without anyone editing it. */
const COMBINATION_COUNT = 2 ** ESTATE_REASONS.length;

/** Every subset of the vocabulary, in declaration order within each subset. */
const COMBINATIONS: readonly (readonly EstateReason[])[] = Object.freeze(
  Array.from({ length: COMBINATION_COUNT }, (_unused, mask) =>
    Object.freeze(ESTATE_REASONS.filter((_r, index) => (mask & (1 << index)) !== 0)),
  ),
);

function stateFor(raised: readonly EstateReason[], path = '/c/a'): WorktreeState {
  return createWorktreeState({
    path,
    branch: 'feat/x',
    // reduce rather than Object.assign(...spread): the spread form erases to
    // any, which discards the very typing that makes RAISE_REASON total.
    ...raised.reduce<Partial<WorktreeState>>((acc, r) => ({ ...acc, ...RAISE_REASON[r] }), {}),
  });
}

const SRC = digestOf('worktree /c/a');
const AT = TimestampSchema.parse('2026-01-01T00:00:00.000Z');

describe('every combination of reasons, derived from the vocabulary', () => {
  it('enumerates 2^N subsets, so the space grows with the vocabulary', () => {
    expect(COMBINATIONS).toHaveLength(COMBINATION_COUNT);
    expect(COMBINATION_COUNT).toBe(2 ** ESTATE_REASONS.length);
    expect(new Set(COMBINATIONS.map((c) => c.join(','))).size).toBe(COMBINATION_COUNT);
  });

  // EVERY reason must be raisable, which is the property a text gate was
  // reaching for -- proven by execution rather than by scanning source.
  it('can raise every reason the vocabulary declares', () => {
    for (const reason of ESTATE_REASONS) {
      expect(reasonsFor(stateFor([reason]))).toEqual([reason]);
    }
  });

  it('raises exactly the reasons the combination names, in declaration order', () => {
    for (const raised of COMBINATIONS) {
      expect(reasonsFor(stateFor(raised))).toEqual(raised);
    }
  });

  // INDEPENDENCE. NIST's result is that most faults come from one or two
  // interacting parameters, so the property worth stating is that there are NO
  // interactions: each reason is raised by its own field and nothing else.
  it('lets each reason be raised regardless of the others', () => {
    for (const raised of COMBINATIONS) {
      const got = reasonsFor(stateFor(raised));
      for (const reason of ESTATE_REASONS) {
        expect(got.includes(reason)).toBe(raised.includes(reason));
      }
    }
  });

  it('is clean for exactly the empty combination', () => {
    const clean = COMBINATIONS.filter((c) => classifyEstate([stateFor(c)]).clean);
    expect(clean).toHaveLength(1);
    for (const c of clean) expect(c).toEqual([]);
  });

  it('never repeats a reason', () => {
    for (const raised of COMBINATIONS) {
      const got = reasonsFor(stateFor(raised));
      expect(new Set(got).size).toBe(got.length);
    }
  });
});

// The mixed cases -- every combination pairing a work-in-progress reason with a
// structural one -- reach the action policy through a REAL worktree state here,
// not through a synthetic reason array.
describe('the end-to-end path, over every combination', () => {
  function actionFor(raised: readonly EstateReason[]): string {
    return decideEstate(observedFixture([stateFor(raised)], SRC)).event.agent_action;
  }

  it('recommends PROCEED only for the empty combination', () => {
    for (const raised of COMBINATIONS) {
      expect(actionFor(raised) === 'PROCEED').toBe(raised.length === 0);
    }
  });

  // STRUCTURAL DOMINATES, proven where it is decided: a worktree whose gitdir
  // points nowhere cannot have work finished inside it, so reporting
  // work-in-progress would send the operator to a remedy that cannot run.
  it('reports STRUCTURAL whenever a structural reason is present, mixed or not', () => {
    for (const raised of COMBINATIONS) {
      if (!raised.some((r) => REASON_KIND[r] === 'structural')) continue;
      expect(actionFor(raised)).toBe('HALT_STRUCTURAL');
    }
  });

  it('reports WORK_IN_PROGRESS only when every reason is the operator\u2019s', () => {
    for (const raised of COMBINATIONS) {
      if (raised.length === 0) continue;
      if (!raised.every((r) => REASON_KIND[r] === 'work-in-progress')) continue;
      expect(actionFor(raised)).toBe('HALT_WORK_IN_PROGRESS');
    }
  });

  it('NEVER permits proceeding while any reason remains', () => {
    for (const raised of COMBINATIONS) {
      if (raised.length === 0) continue;
      expect(mayProceed(actionFor(raised) as never)).toBe(false);
    }
  });

  it('exits 0 for the clean combination and 1 for every other', () => {
    for (const raised of COMBINATIONS) {
      const d = decideEstate(observedFixture([stateFor(raised)], SRC));
      expect(d.exitCode).toBe(raised.length === 0 ? 0 : 1);
    }
  });
});

describe('the emitted event, over every combination', () => {
  function eventFor(raised: readonly EstateReason[]): ReturnType<typeof estateTelemetry> {
    const state = stateFor(raised);
    return estateTelemetry(classifyEstate([state]), null, estateDigest([state]), AT);
  }

  it('carries exactly the raised reasons', () => {
    for (const raised of COMBINATIONS) {
      expect(eventFor(raised).attributes.reasons).toEqual(raised);
    }
  });

  it('carries each kind exactly when a reason of that kind is present', () => {
    for (const raised of COMBINATIONS) {
      const kinds = eventFor(raised).attributes.kinds;
      for (const kind of ['work-in-progress', 'structural'] as const) {
        expect(kinds.includes(kind)).toBe(raised.some((r) => REASON_KIND[r] === kind));
      }
    }
  });

  it('parses against the published contract for every combination', () => {
    for (const raised of COMBINATIONS) {
      expect(EstateEventSchema.safeParse(eventFor(raised)).success).toBe(true);
    }
  });

  // Distinct states must be distinctly addressable, or --expect-digest would
  // accept a plan made against a different worktree.
  it('gives every combination a distinct estate digest', () => {
    const digests = COMBINATIONS.map((c) => estateDigest([stateFor(c)]));
    expect(new Set(digests).size).toBe(COMBINATION_COUNT);
  });
});
