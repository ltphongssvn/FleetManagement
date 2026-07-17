// packages/domain/src/delivery/rollout-guardrail.ts
// Progressive-delivery guardrail SSOT. A guardrail is one automated check the
// analysis runs at each rollout stage against a real metric read from an
// observability platform -- never a hard-coded object.
//
// Shape follows the two dominant 2026 controllers. Bounds are ABSOLUTE, matching
// Flagger thresholdRange ({min: 99} for success-rate, {max: 500} for
// request-duration) and Argo successCondition (result[0] >= 0.95). A min-bounded
// guardrail means higher is better; a max-bounded one means lower is better; both
// bounds together describe a window.
//
// failureLimit is the failure budget, and it is what makes hold a distinct
// verdict from rollback. Argo fails an analysis only after failureLimit
// measurements breach the bound (default 3); Flagger spells the same idea
// threshold: 5. One bad sample therefore means the evidence is not yet
// conclusive -- keep the current exposure rather than returning traffic to the
// previous version. Without a budget there is no hold, only promote and rollback.
//
// The metric name is deliberately free-form. Both controllers query arbitrary
// named metrics from Prometheus, Datadog or any other platform, so the vocabulary
// is genuinely open and the name IS the query key. This is the opposite ruling to
// the rollout stage id, which was deleted because a stage is identified by
// position and weight and nothing consumed the string.
//
// DEFAULT_GUARDRAILS watches a success-rate floor AND a latency ceiling, because
// the 2026 guidance is explicit that error rate alone misses performance
// degradations: a canary can answer every request correctly and still be slow.
//
// Schema-first: Guardrail and GuardrailSet derive via z.infer; no shape is
// hand-written anywhere.
import { z } from 'zod';

/** Canonical breach budget before an analysis is considered failed (Argo failureLimit). */
export const DEFAULT_FAILURE_LIMIT = 3;

export const GuardrailSchema = z
  .object({
    metric: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    failureLimit: z.number().int().positive().default(DEFAULT_FAILURE_LIMIT),
  })
  .strict()
  .refine((g) => g.min !== undefined || g.max !== undefined, {
    message: 'a guardrail needs at least one bound, or it guards nothing',
  })
  .refine((g) => g.min === undefined || g.max === undefined || g.min <= g.max, {
    message: 'an inverted window can never be satisfied: min must not exceed max',
  });

export type Guardrail = z.infer<typeof GuardrailSchema>;

export const GuardrailSetSchema = z
  .array(GuardrailSchema)
  .min(1)
  .refine((set) => new Set(set.map((g) => g.metric)).size === set.length, {
    message: 'two rules for one metric conflict: each metric is guarded once',
  });

export type GuardrailSet = z.infer<typeof GuardrailSetSchema>;

export const DEFAULT_GUARDRAILS: GuardrailSet = Object.freeze([
  Object.freeze({
    metric: 'request-success-rate',
    min: 99,
    failureLimit: DEFAULT_FAILURE_LIMIT,
  }),
  Object.freeze({
    metric: 'request-duration-p95-ms',
    max: 500,
    failureLimit: DEFAULT_FAILURE_LIMIT,
  }),
]) as GuardrailSet;
