// packages/domain/test/rollout-analysis.test.ts
// RED-first test for the analysis engine: the pure function that reads real
// metric samples against the guardrails and returns a four-way verdict. This is
// what a deployment controller calls at each stage.
//
// The four outcomes, and the two SEPARATE budgets that produce them, follow the
// model the dominant 2026 controllers use (Argo Rollouts analysis_types.go):
//   promote      -> every guarded metric was present and satisfied its bound
//   hold         -> a metric was present and VIOLATED its bound, but under its
//                   failureLimit of consecutive breaches
//   rollback     -> a real breach reached failureLimit consecutive times
//   inconclusive -> a guarded metric could not be evaluated (absent from the
//                   samples), under the inconclusive budget
//
// The crucial separation: an ABSENT metric is inconclusive, NOT a breach. Argo
// tracks failureLimit and inconclusiveLimit independently precisely so that a
// metrics pipeline that stopped reporting does not get counted as an SLO
// violation. A real bound-violation and a no-data reading are different facts and
// draw down different budgets. Both budgets, when exhausted, end in rollback -- a
// canary that can never be evaluated is as unshippable as one that is failing --
// but the paths there are distinct and separately counted.
//
// Both tallies are carried in, not recomputed: the engine is pure and stateless,
// the controller owns the running counts and passes them; a clear evaluation is
// the controller signal to reset.
import { describe, it, expect } from 'vitest';
import { decideRollout } from '../src/delivery/rollout-analysis.js';
import { DEFAULT_GUARDRAILS } from '../src/delivery/rollout-guardrail.js';

const AT = '2026-07-17T09:30:00.000Z';
const healthy = [
  { metric: 'request-success-rate', value: 99.9, observedAt: AT },
  { metric: 'request-duration-p95-ms', value: 220, observedAt: AT },
];
const successBreach = [
  { metric: 'request-success-rate', value: 91, observedAt: AT },
  { metric: 'request-duration-p95-ms', value: 220, observedAt: AT },
];
const latencyBreach = [
  { metric: 'request-success-rate', value: 99.9, observedAt: AT },
  { metric: 'request-duration-p95-ms', value: 980, observedAt: AT },
];

// No prior breaches and no prior inconclusives recorded for any metric.
const fresh = {};

describe('decideRollout: promote when every guardrail holds', () => {
  it('promotes on healthy metrics with no history', () => {
    expect(decideRollout(healthy, DEFAULT_GUARDRAILS, fresh, fresh)).toBe('promote');
  });

  it('promotes at the exact bound, since the breach is strictly outside it', () => {
    const atBound = [
      { metric: 'request-success-rate', value: 99, observedAt: AT },
      { metric: 'request-duration-p95-ms', value: 500, observedAt: AT },
    ];
    expect(decideRollout(atBound, DEFAULT_GUARDRAILS, fresh, fresh)).toBe('promote');
  });

  it('resets a prior breach count when the metric recovers', () => {
    expect(decideRollout(healthy, DEFAULT_GUARDRAILS, { 'request-success-rate': 2 }, fresh)).toBe(
      'promote',
    );
  });
});

describe('decideRollout: hold on a real breach still within budget', () => {
  it('holds on a first success-rate breach', () => {
    expect(decideRollout(successBreach, DEFAULT_GUARDRAILS, fresh, fresh)).toBe('hold');
  });

  it('holds on a first latency breach', () => {
    expect(decideRollout(latencyBreach, DEFAULT_GUARDRAILS, fresh, fresh)).toBe('hold');
  });

  it('holds on the second breach, one short of the default limit of three', () => {
    expect(decideRollout(successBreach, DEFAULT_GUARDRAILS, { 'request-success-rate': 1 }, fresh)).toBe(
      'hold',
    );
  });
});

describe('decideRollout: rollback once a real breach reaches its failure budget', () => {
  it('rolls back on the third consecutive success-rate breach', () => {
    expect(decideRollout(successBreach, DEFAULT_GUARDRAILS, { 'request-success-rate': 2 }, fresh)).toBe(
      'rollback',
    );
  });

  it('rolls back on the third consecutive latency breach', () => {
    expect(decideRollout(latencyBreach, DEFAULT_GUARDRAILS, { 'request-duration-p95-ms': 2 }, fresh)).toBe(
      'rollback',
    );
  });

  it('rolls back rather than holding when any one metric hits the limit', () => {
    const both = [
      { metric: 'request-success-rate', value: 80, observedAt: AT },
      { metric: 'request-duration-p95-ms', value: 220, observedAt: AT },
    ];
    expect(decideRollout(both, DEFAULT_GUARDRAILS, { 'request-success-rate': 2 }, fresh)).toBe(
      'rollback',
    );
  });
});

describe('decideRollout: an absent metric is inconclusive, never a breach', () => {
  it('returns inconclusive, not hold, when a guarded metric is absent', () => {
    const onlyOne = [{ metric: 'request-success-rate', value: 99.9, observedAt: AT }];
    expect(decideRollout(onlyOne, DEFAULT_GUARDRAILS, fresh, fresh)).toBe('inconclusive');
  });

  it('does not draw an absent metric against the failure budget', () => {
    const onlyOne = [{ metric: 'request-success-rate', value: 99.9, observedAt: AT }];
    expect(decideRollout(onlyOne, DEFAULT_GUARDRAILS, { 'request-duration-p95-ms': 2 }, fresh)).toBe(
      'inconclusive',
    );
  });

  it('rolls back when the inconclusive budget itself is exhausted', () => {
    const onlyOne = [{ metric: 'request-success-rate', value: 99.9, observedAt: AT }];
    expect(decideRollout(onlyOne, DEFAULT_GUARDRAILS, fresh, { 'request-duration-p95-ms': 2 })).toBe(
      'rollback',
    );
  });

  it('prefers a real breach verdict over inconclusive when both are present', () => {
    const breachAndMissing = [{ metric: 'request-success-rate', value: 80, observedAt: AT }];
    expect(decideRollout(breachAndMissing, DEFAULT_GUARDRAILS, { 'request-success-rate': 2 }, fresh)).toBe(
      'rollback',
    );
  });
});
