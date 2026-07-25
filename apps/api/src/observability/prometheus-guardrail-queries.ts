// apps/api/src/observability/prometheus-guardrail-queries.ts
// The PromQL expression for each guardrail metric, plus a lookup that refuses to
// invent one. This is the seam between the domain guardrail vocabulary (declared
// in @fleet/domain, unit-free names and absolute bounds) and the concrete
// Prometheus queries that produce values in those units.
//
// Two correspondences are load-bearing and are pinned by the test against the
// DEFAULT_GUARDRAILS SSOT. First, every guardrail must have a query and every
// query a guardrail: a guardrail with no query reads ABSENT forever (the engine
// routes that to the inconclusive budget and the rollout stalls, with nothing
// visibly wrong), and a query with no guardrail is dead weight. Second, the units
// must match the bounds. The guardrails are declared in PERCENT (success floor 99)
// and MILLISECONDS (p95 ceiling 500); Prometheus counters give ratios and
// histogram buckets give seconds, so the queries scale explicitly -- * 100 for the
// rate, * 1000 for the duration -- or a perfectly healthy service reads as a
// permanent breach and a slow one reads as permanently healthy.

/**
 * PromQL per guarded metric. Keys MUST equal the metric names in
 * DEFAULT_GUARDRAILS exactly; the test enforces the correspondence in both
 * directions so a rename on either side fails loudly instead of silently
 * producing an unqueryable guardrail.
 */
export const GUARDRAIL_PROMQL: Readonly<Record<string, string>> = Object.freeze({
  // Success rate as a percentage: non-5xx responses over all responses, times 100
  // to match the floor of 99. sum(...) over the 5m window smooths single scrapes.
  'request-success-rate':
    'sum(rate(http_requests_total{status!~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100',
  // p95 request duration in milliseconds: the 0.95 histogram quantile over the 5m
  // window, times 1000 to convert Prometheus seconds to the ceiling of 500 ms.
  'request-duration-p95-ms':
    'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) * 1000',
});

/**
 * Resolve the PromQL for a guarded metric, throwing on an unknown name. Returning
 * empty or undefined would send a malformed query, get no data, and surface as
 * inconclusive -- hiding a wiring mistake behind a verdict that looks like a
 * monitoring gap. Failing at the call site keeps the mistake visible.
 */
export function promQLForMetric(metric: string): string {
  const expression = GUARDRAIL_PROMQL[metric];
  if (expression === undefined) {
    throw new Error('no PromQL registered for guardrail metric: ' + metric);
  }
  return expression;
}
