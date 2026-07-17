// packages/domain/src/delivery/rollout-metrics.ts
// Progressive-delivery metric sample SSOT. These readings come from a monitoring
// or observability platform -- Prometheus, Datadog, OTel -- never from a
// hard-coded object. That makes this an Axis-1 trust boundary: the metrics
// adapter parses once, and every consumer downstream is typed.
//
// Two rules are load-bearing.
//
// Finiteness. Prometheus answers an empty query, or a histogram_quantile over an
// empty bucket, with NaN. Every comparison against NaN is false, so whether a NaN
// reading fails open or closed depends purely on how a guardrail check happens to
// be written: value < min sees no breach, while value >= min sees a breach. That
// is a coin flip deciding whether a broken canary gets promoted. Zod v4 rejects
// NaN and both infinities from z.number() by default, so the analysis never has
// to encode the answer in its comparison order. No .finite() modifier: it is a
// deprecated no-op in v4, and the four non-finite cases in the test file are the
// executable proof of the guarantee -- keep them, they pin the default.
//
// Provenance. observedAt is required because the 2026 guidance is explicit that
// misconfigured analysis produces delayed rollbacks when metric lag is not
// accounted for. A sample scraped before the canary took traffic describes the
// OLD version; promoting on it is promoting on pre-deploy evidence. The contract
// records WHEN the value was observed; the analysis rules on staleness. ISO 8601
// only -- a unix epoch number is rejected rather than guessed at, since seconds
// and milliseconds are indistinguishable by type and differ by a factor of 1000.
//
// Schema-first: MetricSample and RolloutMetrics derive via z.infer; no shape is
// hand-written anywhere.
import { z } from 'zod';

export const MetricSampleSchema = z
  .object({
    metric: z.string().min(1),
    value: z.number(),
    observedAt: z.iso.datetime(),
  })
  .strict();

export type MetricSample = z.infer<typeof MetricSampleSchema>;

export const RolloutMetricsSchema = z
  .array(MetricSampleSchema)
  .min(1)
  .refine((samples) => new Set(samples.map((s) => s.metric)).size === samples.length, {
    message: 'two readings for one metric: the analysis cannot rule on a contradiction',
  });

export type RolloutMetrics = z.infer<typeof RolloutMetricsSchema>;
