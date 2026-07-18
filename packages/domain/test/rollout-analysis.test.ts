// packages/domain/test/rollout-analysis.test.ts
// RED-first test for the analysis engine: the pure function that reads real
// metric samples against the guardrails and returns promote, hold, or rollback.
// This is what a deployment controller calls at each stage to decide whether to
// raise exposure, wait, or return traffic to the previous version.
//
// The verdict is a trichotomy, and the failure budget is what separates the
// middle case from the extremes:
//   promote  -> every guardrail is satisfied this evaluation
//   hold     -> at least one guardrail is breaching, but no metric has reached
//               its failureLimit of consecutive breaches yet: the evidence is
//               real but not yet conclusive, so keep the current exposure
//   rollback -> some metric has breached failureLimit consecutive times
//
// The consecutive-breach count is carried in, not recomputed, because the engine
// is pure and stateless: the controller owns the running tally across evaluations
// and passes the count so far. A breach this evaluation increments it; a clear
// evaluation is the controller's signal to reset it.
//
// A guardrail whose metric is ABSENT from the samples is a breach, not a pass.
// Missing evidence is not evidence of health -- a metrics pipeline that stopped
// reporting must not read as promote.
//
// Metrics arrive already validated (RolloutMetrics), so the engine type-checks
// them rather than re-parsing: this is trusted internal data, past the boundary.
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

// No prior breaches recorded for any metric.
const fresh = {};

describe('decideRollout: promote when every guardrail holds', () => {
  it('promotes on healthy metrics with no breach history', () => {
    expect(decideRollout(healthy, DEFAULT_GUARDRAILS, fresh)).toBe('promote');
  });

  it('promotes at the exact bound, since the breach is strictly outside it', () => {
    const atBound = [
      { metric: 'request-success-rate', value: 99, observedAt: AT },
      { metric: 'request-duration-p95-ms', value: 500, observedAt: AT },
    ];
    expect(decideRollout(atBound, DEFAULT_GUARDRAILS, fresh)).toBe('promote');
  });

  it('resets a prior breach count when the metric recovers', () => {
    expect(decideRollout(healthy, DEFAULT_GUARDRAILS, { 'request-success-rate': 2 })).toBe(
      'promote',
    );
  });
});

describe('decideRollout: hold on a breach still within budget', () => {
  it('holds on a first success-rate breach', () => {
    expect(decideRollout(successBreach, DEFAULT_GUARDRAILS, fresh)).toBe('hold');
  });

  it('holds on a first latency breach', () => {
    expect(decideRollout(latencyBreach, DEFAULT_GUARDRAILS, fresh)).toBe('hold');
  });

  it('holds on the second breach, one short of the default limit of three', () => {
    expect(decideRollout(successBreach, DEFAULT_GUARDRAILS, { 'request-success-rate': 1 })).toBe(
      'hold',
    );
  });
});

describe('decideRollout: rollback once a breach reaches its failure budget', () => {
  it('rolls back on the third consecutive success-rate breach', () => {
    expect(decideRollout(successBreach, DEFAULT_GUARDRAILS, { 'request-success-rate': 2 })).toBe(
      'rollback',
    );
  });

  it('rolls back on the third consecutive latency breach', () => {
    expect(decideRollout(latencyBreach, DEFAULT_GUARDRAILS, { 'request-duration-p95-ms': 2 })).toBe(
      'rollback',
    );
  });

  it('rolls back rather than holding when any one metric hits the limit', () => {
    const both = [
      { metric: 'request-success-rate', value: 80, observedAt: AT },
      { metric: 'request-duration-p95-ms', value: 220, observedAt: AT },
    ];
    expect(decideRollout(both, DEFAULT_GUARDRAILS, { 'request-success-rate': 2 })).toBe('rollback');
  });
});

describe('decideRollout: missing evidence is a breach, not a pass', () => {
  it('does not promote when a guarded metric is absent from the samples', () => {
    const onlyOne = [{ metric: 'request-success-rate', value: 99.9, observedAt: AT }];
    expect(decideRollout(onlyOne, DEFAULT_GUARDRAILS, fresh)).toBe('hold');
  });

  it('rolls back when an absent metric has already reached its budget', () => {
    const onlyOne = [{ metric: 'request-success-rate', value: 99.9, observedAt: AT }];
    expect(decideRollout(onlyOne, DEFAULT_GUARDRAILS, { 'request-duration-p95-ms': 2 })).toBe(
      'rollback',
    );
  });
});
