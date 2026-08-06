// packages/domain/test/rollout-history.test.ts
// RED-first spec for Phase 6-stateful slice 1: the pure tally update.
//
// The gap this closes. decideRollout is stateless -- it READS breachHistory and
// inconclusiveHistory and never advances them; rollout-controller.ts carries
// breachHistory in RolloutState but only ever CLEARS it (on promote or rollback)
// and does not carry inconclusiveHistory at all. So both budgets were permanently
// stuck at zero: a metric could breach forever without failureLimit ever being
// reached, and a metric that never reported could never exhaust the inconclusive
// budget. The two budgets the engine documents did not actually accumulate.
//
// updateHistories is that missing step, kept pure and separate from decideRollout
// so the decision stays a function of state rather than mutating it. The caller
// evaluates, then advances the tallies with the SAME metrics and guardrails, then
// persists both alongside the rollout state.
//
// The rules under test:
//   breach  -> that metric consecutive breach count increments; its inconclusive
//              count resets, because the round WAS evaluable.
//   absent  -> that metric inconclusive count increments; its breach count resets,
//              because no bound was actually violated.
//   pass    -> both counts reset to zero for that metric: consecutive means
//              consecutive, and one clean round is what breaks a streak.
// A metric absent from the guardrails is never tallied, and a zero count is
// dropped rather than stored, so the histories stay small and comparable.
import { describe, it, expect } from 'vitest';
import { updateHistories } from '../src/delivery/rollout-history.js';
import type { GuardrailSet } from '../src/delivery/rollout-guardrail.js';
import type { RolloutMetrics } from '../src/delivery/rollout-metrics.js';

const GUARDRAILS: GuardrailSet = [
  { metric: 'request-success-rate', min: 99, unit: 'PERCENT', failureLimit: 3 },
  { metric: 'request-duration-p95-ms', max: 500, unit: 'MS', failureLimit: 3 },
];

function sample(metric: string, value: number): RolloutMetrics[number] {
  return { metric, value, observedAt: new Date(1751362200 * 1000).toISOString() };
}

const HEALTHY: RolloutMetrics = [
  sample('request-success-rate', 99.9),
  sample('request-duration-p95-ms', 200),
];

describe('updateHistories: a breach accumulates toward the failure budget', () => {
  it('increments the breach count for the violating metric', () => {
    const next = updateHistories(
      [sample('request-success-rate', 98), sample('request-duration-p95-ms', 200)],
      GUARDRAILS,
      {},
      {},
    );
    expect(next.breachHistory['request-success-rate']).toBe(1);
  });

  it('keeps incrementing across consecutive breaching rounds', () => {
    let breach = {};
    let inconclusive = {};
    const breaching: RolloutMetrics = [
      sample('request-success-rate', 98),
      sample('request-duration-p95-ms', 200),
    ];
    for (let i = 0; i < 3; i += 1) {
      const next = updateHistories(breaching, GUARDRAILS, breach, inconclusive);
      breach = next.breachHistory;
      inconclusive = next.inconclusiveHistory;
    }
    expect((breach as Record<string, number>)['request-success-rate']).toBe(3);
  });

  it('does not tally a breach against the metric that passed', () => {
    const next = updateHistories(
      [sample('request-success-rate', 98), sample('request-duration-p95-ms', 200)],
      GUARDRAILS,
      {},
      {},
    );
    expect(next.breachHistory['request-duration-p95-ms']).toBeUndefined();
  });

  it('resets the inconclusive count on a breach -- the round WAS evaluable', () => {
    const next = updateHistories(
      [sample('request-success-rate', 98), sample('request-duration-p95-ms', 200)],
      GUARDRAILS,
      {},
      { 'request-success-rate': 2 },
    );
    expect(next.inconclusiveHistory['request-success-rate']).toBeUndefined();
  });
});

describe('updateHistories: an absent metric accumulates toward the inconclusive budget', () => {
  it('increments the inconclusive count for the missing metric', () => {
    const next = updateHistories([sample('request-duration-p95-ms', 200)], GUARDRAILS, {}, {});
    expect(next.inconclusiveHistory['request-success-rate']).toBe(1);
  });

  it('keeps incrementing while the metric stays absent', () => {
    let inconclusive: Record<string, number> = {};
    for (let i = 0; i < 3; i += 1) {
      inconclusive = {
        ...updateHistories([sample('request-duration-p95-ms', 200)], GUARDRAILS, {}, inconclusive)
          .inconclusiveHistory,
      };
    }
    expect(inconclusive['request-success-rate']).toBe(3);
  });

  it('resets the breach count when the metric goes absent -- no bound was violated', () => {
    const next = updateHistories(
      [sample('request-duration-p95-ms', 200)],
      GUARDRAILS,
      { 'request-success-rate': 2 },
      {},
    );
    expect(next.breachHistory['request-success-rate']).toBeUndefined();
  });

  it('treats every guarded metric as absent when nothing was scraped at all', () => {
    const next = updateHistories([], GUARDRAILS, {}, {});
    expect(next.inconclusiveHistory).toEqual({
      'request-success-rate': 1,
      'request-duration-p95-ms': 1,
    });
  });
});

describe('updateHistories: one clean round breaks both streaks', () => {
  it('clears a breach streak on a passing round', () => {
    const next = updateHistories(HEALTHY, GUARDRAILS, { 'request-success-rate': 2 }, {});
    expect(next.breachHistory).toEqual({});
  });

  it('clears an inconclusive streak on a passing round', () => {
    const next = updateHistories(HEALTHY, GUARDRAILS, {}, { 'request-success-rate': 2 });
    expect(next.inconclusiveHistory).toEqual({});
  });

  it('drops zero counts rather than storing them', () => {
    const next = updateHistories(HEALTHY, GUARDRAILS, {}, {});
    expect(Object.keys(next.breachHistory)).toEqual([]);
    expect(Object.keys(next.inconclusiveHistory)).toEqual([]);
  });
});

describe('updateHistories: only guarded metrics are tallied', () => {
  it('ignores a sample for a metric that is not guarded', () => {
    const next = updateHistories([...HEALTHY, sample('unguarded', 1)], GUARDRAILS, {}, {});
    expect(next.breachHistory['unguarded']).toBeUndefined();
    expect(next.inconclusiveHistory['unguarded']).toBeUndefined();
  });

  it('does not mutate the histories it was given', () => {
    const breach = { 'request-success-rate': 2 };
    const inconclusive = { 'request-duration-p95-ms': 1 };
    updateHistories(HEALTHY, GUARDRAILS, breach, inconclusive);
    expect(breach).toEqual({ 'request-success-rate': 2 });
    expect(inconclusive).toEqual({ 'request-duration-p95-ms': 1 });
  });
});

describe('updateHistories: the tallies drive the budgets decideRollout reads', () => {
  it('reaches failureLimit after exactly failureLimit consecutive breaches', () => {
    const breaching: RolloutMetrics = [
      sample('request-success-rate', 98),
      sample('request-duration-p95-ms', 200),
    ];
    let breach: Record<string, number> = {};
    for (let i = 0; i < 2; i += 1) {
      breach = { ...updateHistories(breaching, GUARDRAILS, breach, {}).breachHistory };
    }
    // Two rounds tallied; the third breach is what decideRollout turns into
    // rollback, because it compares history + 1 against failureLimit.
    expect(breach['request-success-rate']).toBe(2);
  });
});
