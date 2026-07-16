// packages/domain/test/rollout-verdict.test.ts
// RED-first contract test for the progressive-delivery rollout verdict SSOT.
// Mirrors packages/domain/test/manifest-rejection-reason.test.ts:
// canonical-values / accepts-each / rejects-unknown+empty / type-narrows.
// The verdict is the cross-boundary vocabulary an automated canary analysis
// returns to a deployment controller: promote (raise exposure), hold (keep the
// current percentage), rollback (return traffic to the previous version).
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  ROLLOUT_VERDICTS,
  RolloutVerdictSchema,
  type RolloutVerdict,
} from '../src/delivery/rollout-verdict.js';

describe('rollout verdict: canonical values', () => {
  it('is the exact promote/hold/rollback vocabulary, in order', () => {
    expect(ROLLOUT_VERDICTS).toEqual(['promote', 'hold', 'rollback']);
  });

  it('is frozen at runtime so no caller can mutate the vocabulary', () => {
    expect(Object.isFrozen(ROLLOUT_VERDICTS)).toBe(true);
  });
});

describe('rollout verdict: schema accepts every member', () => {
  it.each([...ROLLOUT_VERDICTS])('accepts %s', (v) => {
    expect(RolloutVerdictSchema.parse(v)).toBe(v);
  });
});

describe('rollout verdict: schema rejects everything else', () => {
  it('rejects a near-miss verdict', () => {
    expect(() => RolloutVerdictSchema.parse('promoted')).toThrow();
  });

  it('rejects the empty string', () => {
    expect(() => RolloutVerdictSchema.parse('')).toThrow();
  });

  it('rejects a non-string', () => {
    expect(() => RolloutVerdictSchema.parse(1)).toThrow();
  });

  it('rejects null and undefined', () => {
    expect(() => RolloutVerdictSchema.parse(null)).toThrow();
    expect(() => RolloutVerdictSchema.parse(undefined)).toThrow();
  });
});

describe('rollout verdict: type derives from the frozen array', () => {
  it('narrows to the three-member union, never widening to string', () => {
    expectTypeOf<RolloutVerdict>().toEqualTypeOf<'promote' | 'hold' | 'rollback'>();
  });
});
