// apps/api/src/observability/prometheus-reader.ts
// Phase 5 Slice 4: the Prometheus READER. Composes the Slice 1-3 pieces into a
// validated RolloutMetrics that the analysis engine (decideRollout) consumes.
//
// The composition, not new mechanics:
//   promQLForMetric   (Slice 3) -- the PromQL for one guarded metric
//   buildInstantQueryUrl (Slice 1) -- correct percent-encoded instant-query URL
//   PrometheusInstantQuerySchema (Slice 1) -- the wire trust boundary
//   toRolloutMetrics  (Slice 1) -- responses -> samples, omitting the absent
//
// Purity split follows scripts/ci/ci-minutes-fetch.ts: planGuardrailQueries,
// parseInstantQueryPayload and readRolloutMetricsFrom are PURE. The single
// side-effecting act -- shelling out to curl -- is behind the InstantQueryFetcher
// port, so readRolloutMetrics itself is pure orchestration and every branch of it
// is unit-testable with an in-memory fetcher. curlInstantQuery is the production
// implementation and the default.
//
// The port exists for coverage HONESTY, not ceremony. With the curl call hardwired
// inside, the success path and the null path of the fetch could only be exercised
// against a live Prometheus, so the branches that decide whether a metric is
// present or ABSENT were unreachable by tests -- exactly the branches the rollout
// gate depends on. An untestable decision is an unverified decision.
//
// The ABSENT path is the load-bearing behaviour. A guardrail whose query errors,
// returns an empty vector, or yields a non-finite sample is OMITTED from
// RolloutMetrics. decideRollout routes an absent guarded metric to the
// inconclusive budget; defaulting it to a healthy number would promote a broken
// canary on a confident zero. Nothing here fabricates a sample.
//
// Fail-safe dormancy (Factor III): PROMETHEUS_BASE_URL is optional. Unset means
// the reader is inert and every metric reads ABSENT -> inconclusive -> the rollout
// holds. A monitoring gap must never present as a pass.
import { spawnSync } from 'node:child_process';
import type { GuardrailSet, RolloutMetrics } from '@fleet/domain';
import { promQLForMetric } from './prometheus-guardrail-queries.js';
import {
  buildInstantQueryUrl,
  PrometheusInstantQuerySchema,
  toRolloutMetrics,
  type PrometheusInstantQuery,
} from './prometheus-metrics-adapter.js';

/** One planned instant query: the guarded metric, its PromQL, and its URL. */
export interface GuardrailQuery {
  readonly metric: string;
  readonly promQL: string;
  readonly url: string;
}

/**
 * Port for one instant-query GET. Returns the raw body, or null when the request
 * itself failed (refused, DNS, timeout, HTTP error). Interpreting the body is NOT
 * the fetcher job -- that is parseInstantQueryPayload, so the rule stays pure.
 */
export type InstantQueryFetcher = (url: string, timeoutSeconds: number) => string | null;

/**
 * Plan one instant query per guarded metric, in guardrail order. Pure.
 *
 * Throws when a guardrail has no registered PromQL (via promQLForMetric) rather
 * than skipping it: a silently unqueried guardrail reads ABSENT forever, so the
 * rollout stalls on the inconclusive budget with nothing visibly wrong. Failing
 * here keeps the wiring mistake at the call site.
 */
export function planGuardrailQueries(baseUrl: string, guardrails: GuardrailSet): GuardrailQuery[] {
  return guardrails.map((guardrail) => {
    const promQL = promQLForMetric(guardrail.metric);
    return { metric: guardrail.metric, promQL, url: buildInstantQueryUrl(baseUrl, promQL) };
  });
}

/**
 * Parse a raw instant-query response body. Pure: no I/O, so every branch is
 * unit-testable without Prometheus.
 *
 * Returns null on non-JSON bytes AND on JSON that does not match the documented
 * envelope. Null means ABSENT to the caller, which the engine reads as
 * inconclusive -- the only safe reading of an unintelligible response. Parsing it
 * loosely, or defaulting a missing field, would let a malformed payload masquerade
 * as a healthy sample.
 */
export function parseInstantQueryPayload(body: string): PrometheusInstantQuery | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = PrometheusInstantQuerySchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/**
 * Interpret already-fetched responses as RolloutMetrics. Pure.
 *
 * Delegates to toRolloutMetrics with the guarded metric NAMES, so only guarded
 * metrics can appear and each sample is stamped with the domain metric name rather
 * than the Prometheus __name__ label. A response that is missing, errored, empty,
 * or non-finite is omitted -- the truthful ABSENT signal.
 */
export function readRolloutMetricsFrom(
  responsesByMetric: ReadonlyMap<string, PrometheusInstantQuery>,
  guardrails: GuardrailSet,
): RolloutMetrics {
  return toRolloutMetrics(responsesByMetric, guardrails.map((g) => g.metric));
}

export const DEFAULT_QUERY_TIMEOUT_SECONDS = 5;

/**
 * Production fetcher: GET one instant query with curl. The ONLY function in this
 * module that performs I/O. Zero new dependencies, mirroring the ghGet helper in
 * scripts/ci/ci-minutes-fetch.ts. --fail turns an HTTP error into a non-zero exit,
 * which becomes null here and ABSENT upstream.
 *
 * stdout is returned unguarded: spawnSync with encoding utf-8 always yields a
 * string on a zero exit. A ?? fallback here would be an unreachable branch that
 * no test can honestly cover, and an uncoverable branch is either dead code or an
 * untested decision -- both worse than the invariant stated plainly.
 */
export const curlInstantQuery: InstantQueryFetcher = (url, timeoutSeconds) => {
  const r = spawnSync('curl', [
    '--silent', '--show-error', '--fail',
    '--max-time', String(timeoutSeconds),
    '-H', 'Accept: application/json',
    url,
  ], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout;
};

/**
 * Read the live guardrail metrics from Prometheus. Pure orchestration over the
 * injected fetcher, so every branch is verifiable offline.
 *
 * baseUrl undefined or empty (PROMETHEUS_BASE_URL unset) returns an empty
 * RolloutMetrics: the reader is dormant, every guarded metric is ABSENT, and the
 * engine holds the rollout on the inconclusive budget. That is the fail-safe
 * direction -- an unset monitoring endpoint must never let a canary promote.
 */
export function readRolloutMetrics(
  baseUrl: string | undefined,
  guardrails: GuardrailSet,
  fetcher: InstantQueryFetcher = curlInstantQuery,
  timeoutSeconds: number = DEFAULT_QUERY_TIMEOUT_SECONDS,
): RolloutMetrics {
  if (baseUrl === undefined || baseUrl === '') return [];
  const responses = new Map<string, PrometheusInstantQuery>();
  for (const query of planGuardrailQueries(baseUrl, guardrails)) {
    const body = fetcher(query.url, timeoutSeconds);
    if (body === null) continue;
    const response = parseInstantQueryPayload(body);
    if (response !== null) responses.set(query.metric, response);
  }
  return readRolloutMetricsFrom(responses, guardrails);
}
