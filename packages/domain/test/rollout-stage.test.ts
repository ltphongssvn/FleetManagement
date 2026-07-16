// packages/domain/test/rollout-stage.test.ts
// RED-first contract test for the progressive-delivery rollout ladder SSOT.
// A rollout ladder is the ordered sequence of exposure stages a release climbs:
// internal users first, then a small traffic slice, widening only while the
// automated analysis keeps returning promote. The schema exists to make an
// unsafe ladder unrepresentable rather than caught at deploy time:
//   - it must start at 0 percent, internal-only (deploy is not release)
//   - exposure must strictly ascend (a ladder may never narrow mid-climb)
//   - it must end at 100 percent (a rollout must be able to finish)
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

const internal = { id: 'internal', exposurePercent: 0, internalOnly: true };

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

describe('rollout stage: schema guards the exposure percentage', () => {
  it('accepts a well-formed stage', () => {
    expect(RolloutStageSchema.parse(internal)).toEqual(internal);
  });

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

  it('rejects an empty stage id', () => {
    expect(() => RolloutStageSchema.parse({ ...internal, id: '' })).toThrow();
  });

  it('rejects unknown keys rather than silently ignoring them', () => {
    expect(() => RolloutStageSchema.parse({ ...internal, weight: 50 })).toThrow();
  });
});

describe('rollout ladder: schema makes an unsafe ladder unrepresentable', () => {
  it('rejects an empty ladder', () => {
    expect(() => RolloutLadderSchema.parse([])).toThrow();
  });

  it('rejects a ladder whose exposure narrows mid-climb', () => {
    const narrowing = [
      internal,
      { id: 'ramp_50', exposurePercent: 50, internalOnly: false },
      { id: 'ramp_10', exposurePercent: 10, internalOnly: false },
      { id: 'full', exposurePercent: 100, internalOnly: false },
    ];
    expect(() => RolloutLadderSchema.parse(narrowing)).toThrow();
  });

  it('rejects a ladder that repeats an exposure percentage', () => {
    const repeated = [
      internal,
      { id: 'ramp_10', exposurePercent: 10, internalOnly: false },
      { id: 'ramp_10_again', exposurePercent: 10, internalOnly: false },
      { id: 'full', exposurePercent: 100, internalOnly: false },
    ];
    expect(() => RolloutLadderSchema.parse(repeated)).toThrow();
  });

  it('rejects a ladder that never reaches 100 percent', () => {
    const unfinishable = [internal, { id: 'ramp_50', exposurePercent: 50, internalOnly: false }];
    expect(() => RolloutLadderSchema.parse(unfinishable)).toThrow();
  });

  it('rejects a ladder that does not start at 0 percent internal', () => {
    const noInternal = [
      { id: 'canary', exposurePercent: 5, internalOnly: false },
      { id: 'full', exposurePercent: 100, internalOnly: false },
    ];
    expect(() => RolloutLadderSchema.parse(noInternal)).toThrow();
  });

  it('accepts a custom 5 then 25 ladder, so the stages stay configurable', () => {
    const custom = [
      internal,
      { id: 'canary_5', exposurePercent: 5, internalOnly: false },
      { id: 'ramp_25', exposurePercent: 25, internalOnly: false },
      { id: 'full', exposurePercent: 100, internalOnly: false },
    ];
    expect(RolloutLadderSchema.parse(custom)).toHaveLength(4);
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
