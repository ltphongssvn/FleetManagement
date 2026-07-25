// apps/api/test/prometheus-guardrail-queries.test.ts
// RED-first: every guardrail needs a PromQL expression, and the mapping between
// the two must be exact in BOTH directions. This test is the drift guard.
//
// A guardrail with no query would read ABSENT on every evaluation, which the
// analysis engine routes to the inconclusive budget -- so the rollout would stall
// at inconclusive and eventually roll back, without anything ever being wrong with
// the canary. A query with no guardrail is dead weight that quietly stops being
// exercised. Neither failure announces itself at runtime, so the correspondence is
// asserted here against the DEFAULT_GUARDRAILS SSOT rather than trusted.
//
// Units are part of the contract and are equally silent when wrong. The
// guardrails are declared in PERCENT (success-rate floor 99) and MILLISECONDS
// (p95 ceiling 500), while Prometheus counters give ratios and histogram buckets
// give seconds. An unscaled ratio of 0.997 would sit far below a floor of 99 and
// read as a permanent breach; an unscaled 0.22 seconds would sit far under a
// ceiling of 500 and read as permanently healthy no matter how slow the service
// got. Both directions are silent in production, so the scaling is pinned here.
import { describe, it, expect } from 'vitest';
import { DEFAULT_GUARDRAILS } from '@fleet/domain';
import {
  GUARDRAIL_PROMQL,
  promQLForMetric,
} from '../src/observability/prometheus-guardrail-queries.js';

describe('GUARDRAIL_PROMQL corresponds exactly to the guardrail SSOT', () => {
  it('provides a query for every default guardrail metric', () => {
    for (const guardrail of DEFAULT_GUARDRAILS) {
      expect(Object.keys(GUARDRAIL_PROMQL)).toContain(guardrail.metric);
    }
  });

  it('defines no query for a metric no guardrail watches', () => {
    const guarded = DEFAULT_GUARDRAILS.map((g) => g.metric).sort();
    expect(Object.keys(GUARDRAIL_PROMQL).sort()).toEqual(guarded);
  });

  it('gives every query a non-empty expression', () => {
    for (const expression of Object.values(GUARDRAIL_PROMQL)) {
      expect(expression.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('the queries produce values in the units the guardrails declare', () => {
  it('scales the success rate to a percentage, matching the floor of 99', () => {
    // A raw success ratio is 0 to 1. The guardrail floor is 99, so the query must
    // multiply by 100 or a perfectly healthy service reads as a permanent breach.
    expect(promQLForMetric('request-success-rate')).toContain('* 100');
  });

  it('scales the latency histogram to milliseconds, matching the ceiling of 500', () => {
    // Prometheus duration histograms are in SECONDS. The guardrail ceiling is 500
    // milliseconds, so without the conversion a 2-second p95 reads as 2 and passes.
    expect(promQLForMetric('request-duration-p95-ms')).toContain('* 1000');
  });

  it('reads the p95 quantile the metric name promises', () => {
    expect(promQLForMetric('request-duration-p95-ms')).toContain('0.95');
  });
});

describe('promQLForMetric refuses to invent a query', () => {
  it('throws for an unknown metric rather than returning an empty expression', () => {
    // Returning empty or undefined here would send a malformed query, get no data,
    // and surface as inconclusive -- hiding a wiring mistake behind a verdict that
    // looks like a monitoring gap. Fail loudly at the call site instead.
    expect(() => promQLForMetric('never-declared-metric')).toThrow(/never-declared-metric/);
  });

  it('returns the expression for a known metric', () => {
    expect(promQLForMetric('request-success-rate')).toBe(
      GUARDRAIL_PROMQL['request-success-rate'],
    );
  });
});
