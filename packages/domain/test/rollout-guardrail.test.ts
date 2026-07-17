// packages/domain/test/rollout-guardrail.test.ts
// RED-first contract test for the progressive-delivery guardrail SSOT.
// A guardrail is one automated check the analysis runs against a real metric
// from an observability platform at each rollout stage. Shape follows the two
// dominant 2026 controllers: an absolute threshold range (Flagger
// thresholdRange: {min: 99} for success-rate, {max: 500} for request-duration;
// Argo successCondition: result[0] >= 0.95) plus a failure budget (Argo
// failureLimit: 3, Flagger threshold: 5).
//
// The failure budget is what makes hold a distinct verdict from rollback: Argo
// fails an analysis only after three measurements below the bound, so a single
// bad sample means the evidence is not yet conclusive -- keep the current
// exposure, do not return traffic to the previous version.
//
// The metric name is deliberately free-form. Both controllers query arbitrary
// named metrics from Prometheus, Datadog or any other platform, so the
// vocabulary is genuinely open and the name is the query key. This is the
// opposite ruling to the rollout stage id, which was deleted because a stage is
// identified by position and weight and nothing consumed the string.
//
// Schema-first: types are z.infer; this file never re-declares the shape.
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  DEFAULT_GUARDRAILS,
  GuardrailSchema,
  GuardrailSetSchema,
  DEFAULT_FAILURE_LIMIT,
  type Guardrail,
  type GuardrailSet,
} from '../src/delivery/rollout-guardrail.js';

const successRate = { metric: 'request-success-rate', min: 99 };
const latency = { metric: 'request-duration-p95-ms', max: 500 };

describe('guardrail: bounds are absolute, in either direction', () => {
  it('accepts a min-bounded guardrail, where higher is better', () => {
    expect(GuardrailSchema.parse(successRate).min).toBe(99);
  });

  it('accepts a max-bounded guardrail, where lower is better', () => {
    expect(GuardrailSchema.parse(latency).max).toBe(500);
  });

  it('accepts a two-sided window', () => {
    const parsed = GuardrailSchema.parse({ metric: 'saturation', min: 10, max: 90 });
    expect([parsed.min, parsed.max]).toEqual([10, 90]);
  });

  it('rejects a guardrail with no bound at all, which guards nothing', () => {
    expect(() => GuardrailSchema.parse({ metric: 'request-success-rate' })).toThrow();
  });

  it('rejects an inverted window that no value could satisfy', () => {
    expect(() => GuardrailSchema.parse({ metric: 'saturation', min: 90, max: 10 })).toThrow();
  });
});

describe('guardrail: the failure budget separates hold from rollback', () => {
  it('defaults to the canonical three consecutive breaches', () => {
    expect(GuardrailSchema.parse(successRate).failureLimit).toBe(DEFAULT_FAILURE_LIMIT);
    expect(DEFAULT_FAILURE_LIMIT).toBe(3);
  });

  it('accepts an explicit budget', () => {
    expect(GuardrailSchema.parse({ ...successRate, failureLimit: 5 }).failureLimit).toBe(5);
  });

  it('rejects a zero budget, which would leave a breach with no path to rollback', () => {
    expect(() => GuardrailSchema.parse({ ...successRate, failureLimit: 0 })).toThrow();
  });

  it('rejects a fractional budget, since breaches are counted', () => {
    expect(() => GuardrailSchema.parse({ ...successRate, failureLimit: 1.5 })).toThrow();
  });
});

describe('guardrail: the metric name is an open query key', () => {
  it('accepts a custom metric no fixed vocabulary would enumerate', () => {
    expect(GuardrailSchema.parse({ metric: 'fleet_failed_agent_runs_total', max: 0 }).metric).toBe(
      'fleet_failed_agent_runs_total',
    );
  });

  it('rejects an empty metric name, which queries nothing', () => {
    expect(() => GuardrailSchema.parse({ metric: '', min: 99 })).toThrow();
  });

  it('rejects unknown keys rather than silently ignoring them', () => {
    expect(() => GuardrailSchema.parse({ ...successRate, interval: '5m' })).toThrow();
  });

  it('rejects NaN, which a metrics parse can silently produce', () => {
    expect(() => GuardrailSchema.parse({ metric: 'x', min: NaN })).toThrow();
  });
});

describe('guardrail set: the default watches both failure and performance', () => {
  it('carries a success-rate floor and a latency ceiling', () => {
    expect(DEFAULT_GUARDRAILS.map((g) => g.metric)).toEqual([
      'request-success-rate',
      'request-duration-p95-ms',
    ]);
  });

  it('is frozen so no caller can mutate the shared set', () => {
    expect(Object.isFrozen(DEFAULT_GUARDRAILS)).toBe(true);
  });

  it('satisfies its own schema', () => {
    expect(GuardrailSetSchema.parse(DEFAULT_GUARDRAILS)).toHaveLength(2);
  });
});

describe('guardrail set: schema rejects a set that cannot be evaluated', () => {
  it('rejects an empty set, because an unguarded rollout is not progressive delivery', () => {
    expect(() => GuardrailSetSchema.parse([])).toThrow();
  });

  it('rejects two conflicting rules for the same metric', () => {
    expect(() =>
      GuardrailSetSchema.parse([successRate, { metric: 'request-success-rate', min: 95 }]),
    ).toThrow();
  });

  it('accepts distinct metrics', () => {
    expect(GuardrailSetSchema.parse([successRate, latency])).toHaveLength(2);
  });
});

describe('guardrail: types derive from the schema, never re-declared', () => {
  it('narrows the metric to a string', () => {
    expectTypeOf<Guardrail['metric']>().toEqualTypeOf<string>();
  });

  it('narrows the failure budget to a number after defaulting', () => {
    expectTypeOf<Guardrail['failureLimit']>().toEqualTypeOf<number>();
  });

  it('derives the set element type from the guardrail type', () => {
    expectTypeOf<GuardrailSet[number]>().toEqualTypeOf<Guardrail>();
  });
});
