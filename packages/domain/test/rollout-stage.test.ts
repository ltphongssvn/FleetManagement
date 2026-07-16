// packages/domain/test/rollout-stage.test.ts
// Contract test for the progressive-delivery rollout ladder SSOT.
// A rollout ladder is the ordered sequence of exposure stages a release climbs:
// internal users first, then a small slice of production traffic, widening only
// while the automated analysis keeps returning promote.
//
// A stage has no id. Argo Rollouts and Flagger both identify a stage by its
// position and its weight (Step: 1/8, SetWeight: 20; analysis binds via
// startingStep), never by a name. A name field would force an impossible choice:
// a fixed vocabulary cannot cover an arbitrary weight (5, 25, 30, 75...), and a
// free-form string re-runs the cancel-reason failure where a typo parses clean.
// Deleting the field removes the choice: identity is index plus weight, and a
// typo is unrepresentable because there is no string to mistype.
//
// Schema-first: RolloutStage and RolloutLadder are z.infer of their schemas, so
// this file never re-declares the shape. Only field-level narrowing is asserted,
// which catches a widening regression without becoming a second definition.
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  DEFAULT_ROLLOUT_LADDER,
  RolloutStageSchema,
  RolloutLadderSchema,
  type RolloutStage,
  type RolloutLadder,
} from '../src/delivery/rollout-stage.js';

const internal = { exposurePercent: 0, internalOnly: true };

describe('rollout ladder: default is the canonical staged exposure', () => {
  it('climbs internal, 1, 10, 50, 100', () => {
    expect(DEFAULT_ROLLOUT_LADDER.map((s) => s.exposurePercent)).toEqual([0, 1, 10, 50, 100]);
  });

  it('exposes production traffic only after the internal stage', () => {
    expect(DEFAULT_ROLLOUT_LADDER.map((s) => s.internalOnly)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('is frozen so no caller can mutate the shared ladder', () => {
    expect(Object.isFrozen(DEFAULT_ROLLOUT_LADDER)).toBe(true);
  });

  it('satisfies its own schema', () => {
    expect(RolloutLadderSchema.parse(DEFAULT_ROLLOUT_LADDER)).toHaveLength(5);
  });
});

describe('rollout stage: a stage is a weight, not a name', () => {
  it('accepts a well-formed stage', () => {
    expect(RolloutStageSchema.parse(internal)).toEqual(internal);
  });

  it('rejects an id, because a stage is identified by position and weight', () => {
    expect(() => RolloutStageSchema.parse({ ...internal, id: 'internal' })).toThrow();
  });

  it('rejects any other unknown key rather than silently ignoring it', () => {
    expect(() => RolloutStageSchema.parse({ ...internal, weight: 50 })).toThrow();
  });
});

describe('rollout stage: schema guards the exposure percentage', () => {
  it('rejects exposure below 0 or above 100', () => {
    expect(() => RolloutStageSchema.parse({ ...internal, exposurePercent: -1 })).toThrow();
    expect(() => RolloutStageSchema.parse({ ...internal, exposurePercent: 101 })).toThrow();
  });

  it('rejects a fractional exposure percentage', () => {
    expect(() => RolloutStageSchema.parse({ ...internal, exposurePercent: 5.5 })).toThrow();
  });

  it('rejects NaN, which a config or metrics parse can silently produce', () => {
    expect(() => RolloutStageSchema.parse({ ...internal, exposurePercent: NaN })).toThrow();
  });

  it('rejects a missing exposure percentage', () => {
    expect(() => RolloutStageSchema.parse({ internalOnly: true })).toThrow();
  });
});

describe('rollout ladder: schema makes an unsafe ladder unrepresentable', () => {
  it('rejects an empty ladder', () => {
    expect(() => RolloutLadderSchema.parse([])).toThrow();
  });

  it('rejects a ladder whose exposure narrows mid-climb', () => {
    const narrowing = [
      internal,
      { exposurePercent: 50, internalOnly: false },
      { exposurePercent: 10, internalOnly: false },
      { exposurePercent: 100, internalOnly: false },
    ];
    expect(() => RolloutLadderSchema.parse(narrowing)).toThrow();
  });

  it('rejects a ladder that repeats an exposure percentage', () => {
    const repeated = [
      internal,
      { exposurePercent: 10, internalOnly: false },
      { exposurePercent: 10, internalOnly: false },
      { exposurePercent: 100, internalOnly: false },
    ];
    expect(() => RolloutLadderSchema.parse(repeated)).toThrow();
  });

  it('rejects a ladder that never reaches 100 percent', () => {
    const unfinishable = [internal, { exposurePercent: 50, internalOnly: false }];
    expect(() => RolloutLadderSchema.parse(unfinishable)).toThrow();
  });

  it('rejects a ladder that does not start at 0 percent', () => {
    const noInternal = [
      { exposurePercent: 5, internalOnly: false },
      { exposurePercent: 100, internalOnly: false },
    ];
    expect(() => RolloutLadderSchema.parse(noInternal)).toThrow();
  });

  it('rejects a ladder whose first stage is 0 percent but not internal-only', () => {
    const notInternal = [
      { exposurePercent: 0, internalOnly: false },
      { exposurePercent: 100, internalOnly: false },
    ];
    expect(() => RolloutLadderSchema.parse(notInternal)).toThrow();
  });
});

describe('rollout ladder: any ascending weights are expressible', () => {
  it('accepts a 5 then 25 climb, the weights Argo and Flagger docs use', () => {
    const custom = [
      internal,
      { exposurePercent: 5, internalOnly: false },
      { exposurePercent: 25, internalOnly: false },
      { exposurePercent: 100, internalOnly: false },
    ];
    expect(RolloutLadderSchema.parse(custom)).toHaveLength(4);
  });

  it('accepts an arbitrary weight no fixed vocabulary would have enumerated', () => {
    const arbitrary = [
      internal,
      { exposurePercent: 3, internalOnly: false },
      { exposurePercent: 37, internalOnly: false },
      { exposurePercent: 100, internalOnly: false },
    ];
    expect(RolloutLadderSchema.parse(arbitrary)).toHaveLength(4);
  });

  it('accepts the shortest legal ladder: internal then full', () => {
    expect(RolloutLadderSchema.parse([internal, { exposurePercent: 100, internalOnly: false }])).toHaveLength(2);
  });
});

describe('rollout stage: types derive from the schema, never re-declared', () => {
  it('narrows exposurePercent to number, not any', () => {
    expectTypeOf<RolloutStage['exposurePercent']>().toEqualTypeOf<number>();
  });

  it('narrows internalOnly to boolean, not any', () => {
    expectTypeOf<RolloutStage['internalOnly']>().toEqualTypeOf<boolean>();
  });

  it('derives the ladder element type from the stage type', () => {
    expectTypeOf<RolloutLadder[number]>().toEqualTypeOf<RolloutStage>();
  });
});
