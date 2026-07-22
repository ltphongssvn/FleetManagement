// apps/api/src/observability/prometheus-metrics-adapter.ts
// The Prometheus metrics adapter: the boundary that turns a Prometheus
// /api/v1/query instant-vector response into the validated RolloutMetrics the
// analysis engine consumes. Pure schema + pure transforms are exported and
// unit-tested; the HTTP call is isolated in a main()-only helper, mirroring
// scripts/ci/ci-minutes-fetch.ts.
//
// Grounded in the Prometheus HTTP API docs. An instant query returns
//   { status, data: { resultType, result: [ { metric, value: [ ts, str ] } ] }, errorType?, error? }
// and three facts shape this adapter:
//   1. the sample value is a STRING, so it is Number()-coerced here; that is
//      where NaN can enter.
//   2. the timestamp is unix SECONDS (float). MetricSampleSchema requires an ISO
//      observedAt and deliberately rejects epoch numbers (the s/ms ambiguity is
//      unsafe to guess), so the conversion is explicit: seconds * 1000 -> ISO.
//   3. status:error and an empty result[] are no-data. They are mapped to ABSENT
//      (the series is omitted from RolloutMetrics), never to a fabricated healthy
//      sample. decideRollout then routes an absent guarded metric to the
//      inconclusive budget rather than counting it as a breach. A confident zero
//      is a lie: no data must never read as a pass.
import { z } from 'zod';
import {
  MetricSampleSchema,
  type MetricSample,
  type RolloutMetrics,
} from '@fleet/domain';

// The instant-query value tuple: [ unix_seconds_float, sample_as_string ].
const InstantValueSchema = z.tuple([z.number(), z.string()]);

// One vector row. Labels are free-form; we do not constrain them.
const InstantResultRowSchema = z
  .object({
    metric: z.record(z.string(), z.string()),
    value: InstantValueSchema,
  })
  .strict();

export type InstantResultRow = z.infer<typeof InstantResultRowSchema>;

// The full documented instant-query envelope. data is optional because an error
// response omits it; errorType / error appear only on status:error. .strict() so
// an unexpected wire shape is a loud parse failure, not a silent misread.
export const PrometheusInstantQuerySchema = z
  .object({
    status: z.enum(['success', 'error']),
    data: z
      .object({
        resultType: z.literal('vector'),
        result: z.array(InstantResultRowSchema),
      })
      .strict()
      .optional(),
    errorType: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();

export type PrometheusInstantQuery = z.infer<typeof PrometheusInstantQuerySchema>;

// A small exported table proving the unix-seconds -> ISO conversion, so the rule
// is pinned by data rather than asserted once inline.
export const UNIX_SECONDS_TO_ISO_TESTS = [
  { seconds: 1435781451.781, iso: new Date(1435781451.781 * 1000).toISOString() },
  { seconds: 0, iso: new Date(0).toISOString() },
  { seconds: 1751362200, iso: new Date(1751362200 * 1000).toISOString() },
] as const;

/**
 * Convert one Prometheus vector row to a MetricSample, or null when the sample
 * cannot be evaluated. The caller supplies the metric NAME the guardrails use --
 * the Prometheus __name__ label is an implementation detail of the query and is
 * not trusted as the domain metric key.
 *
 * Returns null (not a zero, not a throw) when the coerced value is non-finite:
 * NaN, +/-Infinity, or a non-numeric string. A null is an ABSENT reading -- the
 * caller omits it from RolloutMetrics and the engine treats the guarded metric as
 * inconclusive. This is the point where a confident zero would otherwise be born.
 */
export function toMetricSample(metricName: string, row: InstantResultRow): MetricSample | null {
  const raw = row.value[1];
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const observedAt = new Date(row.value[0] * 1000).toISOString();
  const parsed = MetricSampleSchema.safeParse({ metric: metricName, value, observedAt });
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Turn a parsed Prometheus response into RolloutMetrics for a set of named
 * metrics. Each name maps to at most one row (an instant query per guardrail).
 * A metric whose query errored, returned no vector, returned an empty vector, or
 * returned a non-finite sample is OMITTED -- never fabricated. The engine sees
 * the omission as inconclusive. The returned array may therefore be shorter than
 * metricNames; that is the truthful signal, not a defect.
 */
export function toRolloutMetrics(
  responsesByMetric: ReadonlyMap<string, PrometheusInstantQuery>,
  metricNames: readonly string[],
): RolloutMetrics {
  const samples: MetricSample[] = [];
  for (const name of metricNames) {
    const response = responsesByMetric.get(name);
    if (response === undefined) continue;
    if (response.status !== 'success') continue;
    const rows = response.data?.result ?? [];
    const firstRow = rows[0];
    if (firstRow === undefined) continue;
    const sample = toMetricSample(name, firstRow);
    if (sample !== null) samples.push(sample);
  }
  return samples;
}
