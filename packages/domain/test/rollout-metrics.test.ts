// packages/domain/test/rollout-metrics.test.ts
// RED-first contract test for the metric samples the analysis reads.
// These arrive from a monitoring or observability platform -- Prometheus,
// Datadog, OTel -- never from a hard-coded object. That makes this an Axis-1
// trust boundary: the adapter parses, and everything downstream is typed.
//
// Two rules are load-bearing.
//
// 1. A value must be FINITE. Prometheus answers an empty query, or a
//    histogram_quantile over an empty bucket, with NaN. Every comparison against
//    NaN is false, so whether a NaN sample fails open or closed depends purely on
//    how the guardrail check happens to be written: value < min sees no breach,
//    while value >= min sees a breach. That is a coin flip deciding whether a
//    broken canary gets promoted. Rejecting non-finite values at the boundary
//    removes the ambiguity instead of relying on comparison order.
//
// 2. A sample carries observedAt. The 2026 guidance is explicit that
//    misconfigured analysis leads to delayed rollbacks when metric lag is not
//    accounted for: a sample scraped before the canary took traffic describes the
//    OLD version, and promoting on it is promoting on pre-deploy evidence. The
//    contract records when the value was observed; the analysis rules on
//    staleness.
//
// Schema-first: types are z.infer; this file never re-declares the shape.
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  MetricSampleSchema,
  RolloutMetricsSchema,
  type MetricSample,
  type RolloutMetrics,
} from '../src/delivery/rollout-metrics.js';

const OBSERVED_AT = '2026-07-17T09:30:00.000Z';
const successRate = { metric: 'request-success-rate', value: 99.7, observedAt: OBSERVED_AT };
const latency = { metric: 'request-duration-p95-ms', value: 412, observedAt: OBSERVED_AT };

describe('metric sample: a reading from the observability platform', () => {
  it('accepts a well-formed sample', () => {
    expect(MetricSampleSchema.parse(successRate)).toEqual(successRate);
  });

  it('accepts a fractional value, since a rate is not an integer', () => {
    expect(MetricSampleSchema.parse(successRate).value).toBe(99.7);
  });

  it('accepts zero, which is a real reading and not a missing one', () => {
    expect(MetricSampleSchema.parse({ ...successRate, value: 0 }).value).toBe(0);
  });

  it('accepts a negative value, since a delta metric can fall below zero', () => {
    expect(MetricSampleSchema.parse({ ...successRate, value: -12 }).value).toBe(-12);
  });
});

describe('metric sample: non-finite readings are rejected at the boundary', () => {
  it('rejects NaN, which Prometheus returns for an empty query', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, value: NaN })).toThrow();
  });

  it('rejects Infinity, which a divide-by-zero rate produces', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, value: Infinity })).toThrow();
  });

  it('rejects negative Infinity', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, value: -Infinity })).toThrow();
  });

  it('rejects a stringified number rather than coercing a platform response', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, value: '99.7' })).toThrow();
  });

  it('rejects a missing value', () => {
    expect(() => MetricSampleSchema.parse({ metric: 'x', observedAt: OBSERVED_AT })).toThrow();
  });
});

describe('metric sample: identity and provenance', () => {
  it('rejects an empty metric name, which names no query', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, metric: '' })).toThrow();
  });

  it('requires observedAt, so staleness is decidable', () => {
    expect(() => MetricSampleSchema.parse({ metric: 'x', value: 1 })).toThrow();
  });

  it('rejects a non-ISO timestamp', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, observedAt: 'yesterday' })).toThrow();
  });

  it('rejects a unix epoch number, which many platforms emit and must be normalised', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, observedAt: 1752745800 })).toThrow();
  });

  it('rejects unknown keys rather than silently ignoring them', () => {
    expect(() => MetricSampleSchema.parse({ ...successRate, labels: { pod: 'a' } })).toThrow();
  });
});

describe('rollout metrics: the set the analysis evaluates', () => {
  it('accepts distinct metrics', () => {
    expect(RolloutMetricsSchema.parse([successRate, latency])).toHaveLength(2);
  });

  it('rejects an empty set, because no evidence is not evidence of health', () => {
    expect(() => RolloutMetricsSchema.parse([])).toThrow();
  });

  it('rejects two readings for one metric, which the analysis cannot rule on', () => {
    expect(() =>
      RolloutMetricsSchema.parse([successRate, { ...successRate, value: 12 }]),
    ).toThrow();
  });
});

describe('metric sample: types derive from the schema, never re-declared', () => {
  it('narrows value to a number', () => {
    expectTypeOf<MetricSample['value']>().toEqualTypeOf<number>();
  });

  it('narrows metric to a string', () => {
    expectTypeOf<MetricSample['metric']>().toEqualTypeOf<string>();
  });

  it('derives the set element type from the sample type', () => {
    expectTypeOf<RolloutMetrics[number]>().toEqualTypeOf<MetricSample>();
  });
});
