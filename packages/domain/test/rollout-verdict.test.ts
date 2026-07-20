// packages/domain/test/rollout-verdict.test.ts
// RED-first contract test for the progressive-delivery rollout verdict SSOT.
// Mirrors packages/domain/test/manifest-rejection-reason.test.ts:
// canonical-values / accepts-each / rejects-unknown+empty / type-narrows.
//
// The verdict is the cross-boundary vocabulary an automated canary analysis
// returns to a deployment controller. It is a FOUR-member vocabulary, matching
// the model the dominant 2026 controllers use (Argo Rollouts analysis_types.go,
// OpsMx nanStrategy): a measurement that ran and passed, one that ran and
// violated, one that could not be judged, and the wait state are four different
// facts, not three.
//   promote      -> raise exposure to the next stage
//   hold         -> evaluated, a guardrail is breaching, but under its failure
//                   budget: keep the current percentage
//   rollback     -> return traffic to the previous version
//   inconclusive -> the evidence could not be evaluated this round (a metric was
//                   absent, or the query returned no data / NaN, or the query
//                   errored). NOT a breach: an unreachable Prometheus must not be
//                   counted against the failure budget. It carries its own
//                   separate budget in the controller, mirroring Argo
//                   inconclusiveLimit / consecutiveErrorLimit.
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  ROLLOUT_VERDICTS,
  RolloutVerdictSchema,
  type RolloutVerdict,
} from '../src/delivery/rollout-verdict.js';

describe('rollout verdict: canonical values', () => {
  it('is the exact promote/hold/rollback/inconclusive vocabulary, in order', () => {
    expect(ROLLOUT_VERDICTS).toEqual(['promote', 'hold', 'rollback', 'inconclusive']);
  });

  it('is frozen at runtime so no caller can mutate the vocabulary', () => {
    expect(Object.isFrozen(ROLLOUT_VERDICTS)).toBe(true);
  });

  it('carries inconclusive as a member distinct from the three action verdicts', () => {
    expect(ROLLOUT_VERDICTS).toContain('inconclusive');
    expect(new Set(ROLLOUT_VERDICTS).size).toBe(ROLLOUT_VERDICTS.length);
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
  it('narrows to the four-member union, never widening to string', () => {
    expectTypeOf<RolloutVerdict>().toEqualTypeOf<'promote' | 'hold' | 'rollback' | 'inconclusive'>();
  });
});
