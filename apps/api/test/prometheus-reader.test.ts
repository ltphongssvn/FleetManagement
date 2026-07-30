// apps/api/test/prometheus-reader.test.ts
// RED->GREEN spec for Phase 5 Slice 4: the Prometheus READER that assembles the
// already-tested pure pieces into validated RolloutMetrics.
//
// Slices 1-3 built the parts: PrometheusInstantQuerySchema + toMetricSample +
// toRolloutMetrics (the wire boundary), buildInstantQueryUrl (encoding), and
// GUARDRAIL_PROMQL + promQLForMetric (the query per guardrail). Slice 4 is the
// composition: given a base URL and a set of guarded metric names, produce the
// query plan, and given the fetched responses, produce RolloutMetrics.
//
// The plan is a PURE function so the composition is unit-tested without a running
// Prometheus. The curl call stays in a main()-only helper, the ci-minutes-fetch.ts
// precedent -- fetch is I/O, planning and interpretation are rules.
//
// The load-bearing behaviour under test is the ABSENT path. A guardrail whose
// query errors, returns an empty vector, or yields a non-finite sample must be
// OMITTED from RolloutMetrics, never defaulted to a healthy number: decideRollout
// routes an absent guarded metric to the inconclusive budget, and a confident zero
// would instead read as a pass and promote a broken canary.
import { describe, it, expect } from 'vitest';
import { DEFAULT_GUARDRAILS } from '@fleet/domain';
import {
  planGuardrailQueries,
  parseInstantQueryPayload,
  readRolloutMetricsFrom,
  readRolloutMetrics,
  curlInstantQuery,
  type GuardrailQuery,
  type InstantQueryFetcher,
} from '../src/observability/prometheus-reader.js';
import {
  PrometheusInstantQuerySchema,
  type PrometheusInstantQuery,
} from '../src/observability/prometheus-metrics-adapter.js';

const BASE = 'http://prometheus.internal:9090';

function successResponse(seconds: number, value: string): PrometheusInstantQuery {
  return PrometheusInstantQuerySchema.parse({
    status: 'success',
    data: {
      resultType: 'vector',
      result: [{ metric: { __name__: 'whatever' }, value: [seconds, value] }],
    },
  });
}

const emptyVector: PrometheusInstantQuery = PrometheusInstantQuerySchema.parse({
  status: 'success',
  data: { resultType: 'vector', result: [] },
});

const errorResponse: PrometheusInstantQuery = PrometheusInstantQuerySchema.parse({
  status: 'error',
  errorType: 'bad_data',
  error: 'parse error',
});

describe('planGuardrailQueries composes the query plan', () => {
  it('produces one query per guarded metric, in guardrail order', () => {
    const plan = planGuardrailQueries(BASE, DEFAULT_GUARDRAILS);
    expect(plan.length).toBe(DEFAULT_GUARDRAILS.length);
    expect(plan.map((q: GuardrailQuery) => q.metric))
      .toEqual(DEFAULT_GUARDRAILS.map((g) => g.metric));
  });

  it('gives every query an absolute instant-query URL carrying the encoded PromQL', () => {
    for (const q of planGuardrailQueries(BASE, DEFAULT_GUARDRAILS)) {
      expect(q.url.startsWith(BASE + '/api/v1/query?')).toBe(true);
      expect(q.url).toContain('query=');
      // PromQL is percent-encoded: no raw space, brace or quote survives.
      expect(q.url).not.toContain(' ');
      expect(q.url).not.toContain('{');
      expect(q.url).not.toContain(String.fromCharCode(34));
    }
  });

  it('round-trips the exact PromQL through the URL, losing nothing', () => {
    for (const q of planGuardrailQueries(BASE, DEFAULT_GUARDRAILS)) {
      const decoded = new URL(q.url).searchParams.get('query');
      expect(decoded).toBe(q.promQL);
    }
  });

  it('normalises a base URL with a trailing slash to one /api/v1/query path', () => {
    const plan = planGuardrailQueries(BASE + '/', DEFAULT_GUARDRAILS);
    for (const q of plan) {
      expect(q.url).toContain('/api/v1/query');
      expect(q.url).not.toContain('//api/v1/query');
    }
  });

  it('throws for a guardrail with no registered PromQL rather than querying nothing', () => {
    const bogus = [{ metric: 'not-registered', direction: 'min', threshold: 1, unit: 'PERCENT' }];
    expect(() => planGuardrailQueries(BASE, bogus as never)).toThrow();
  });
});

describe('parseInstantQueryPayload is the pure wire boundary', () => {
  it('parses a documented success envelope', () => {
    const body = JSON.stringify({
      status: 'success',
      data: {
        resultType: 'vector',
        result: [{ metric: {}, value: [1751362200, '99.5'] }],
      },
    });
    const parsed = parseInstantQueryPayload(body);
    expect(parsed?.status).toBe('success');
    expect(parsed?.data?.result.length).toBe(1);
  });

  it('parses a documented error envelope, which the caller reads as ABSENT', () => {
    const body = JSON.stringify({ status: 'error', errorType: 'bad_data', error: 'boom' });
    expect(parseInstantQueryPayload(body)?.status).toBe('error');
  });

  it('returns null for non-JSON bytes rather than throwing into the caller', () => {
    expect(parseInstantQueryPayload('<html>502 Bad Gateway</html>')).toBeNull();
    expect(parseInstantQueryPayload('')).toBeNull();
  });

  it('returns null for JSON that does not match the documented envelope', () => {
    // A plausible-looking but wrong shape must never pass: it would become a
    // fabricated sample. .strict() rejects unknown keys and bad resultTypes.
    expect(parseInstantQueryPayload(JSON.stringify({ status: 'ok' }))).toBeNull();
    expect(parseInstantQueryPayload(JSON.stringify({
      status: 'success',
      data: { resultType: 'matrix', result: [] },
    }))).toBeNull();
    expect(parseInstantQueryPayload(JSON.stringify({
      status: 'success',
      data: { resultType: 'vector', result: [], unexpected: 1 },
    }))).toBeNull();
  });
});

describe('readRolloutMetrics orchestrates over an injected fetcher', () => {
  const okBody = (value: string): string => JSON.stringify({
    status: 'success',
    data: { resultType: 'vector', result: [{ metric: {}, value: [1751362200, value] }] },
  });

  it('returns a sample per metric when every fetch succeeds', () => {
    const fetcher: InstantQueryFetcher = () => okBody('99.9');
    const metrics = readRolloutMetrics(BASE, DEFAULT_GUARDRAILS, fetcher);
    expect(metrics.length).toBe(DEFAULT_GUARDRAILS.length);
    expect(metrics.every((m) => m.value === 99.9)).toBe(true);
  });

  it('queries the planned URL for each guardrail, encoded', () => {
    const seen: string[] = [];
    const fetcher: InstantQueryFetcher = (url) => { seen.push(url); return okBody('1'); };
    readRolloutMetrics(BASE, DEFAULT_GUARDRAILS, fetcher);
    expect(seen).toEqual(planGuardrailQueries(BASE, DEFAULT_GUARDRAILS).map((p) => p.url));
  });

  it('passes the timeout through to the fetcher', () => {
    const seen: number[] = [];
    const fetcher: InstantQueryFetcher = (_url, t) => { seen.push(t); return okBody('1'); };
    readRolloutMetrics(BASE, DEFAULT_GUARDRAILS, fetcher, 11);
    expect(seen.every((t) => t === 11)).toBe(true);
  });

  it('OMITS a metric whose fetch returned null (request failed) -- ABSENT, not zero', () => {
    // The branch that decides present-vs-absent on a failed request. Hardwired to
    // curl it could only be reached with a live endpoint; injected, it is proven.
    const fetcher: InstantQueryFetcher = () => null;
    expect(readRolloutMetrics(BASE, DEFAULT_GUARDRAILS, fetcher)).toEqual([]);
  });

  it('OMITS a metric whose body is unparseable, keeping the parseable ones', () => {
    const first = DEFAULT_GUARDRAILS[0];
    const firstUrl = planGuardrailQueries(BASE, DEFAULT_GUARDRAILS)[0]?.url;
    const fetcher: InstantQueryFetcher = (url) =>
      url === firstUrl ? '<html>502</html>' : okBody('42');
    const metrics = readRolloutMetrics(BASE, DEFAULT_GUARDRAILS, fetcher);
    expect(metrics.some((m) => m.metric === first?.metric)).toBe(false);
    expect(metrics.length).toBe(DEFAULT_GUARDRAILS.length - 1);
  });

  it('never calls the fetcher at all when the endpoint is unset (dormant)', () => {
    // Factor III fail-safe: no endpoint means every guarded metric is ABSENT, so
    // decideRollout holds the rollout on the inconclusive budget. It must never
    // look like a pass, and it must not attempt a request.
    let calls = 0;
    const fetcher: InstantQueryFetcher = () => { calls += 1; return okBody('1'); };
    expect(readRolloutMetrics(undefined, DEFAULT_GUARDRAILS, fetcher)).toEqual([]);
    expect(readRolloutMetrics('', DEFAULT_GUARDRAILS, fetcher)).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('curlInstantQuery is the production fetcher', () => {
  it('returns null when the endpoint is unreachable, so the metric reads ABSENT', () => {
    // A closed port exercises the real curl failure path with no Prometheus: curl
    // exits non-zero, fetchInstantQuery returns null, the metric is omitted. The
    // engine sees inconclusive rather than a fabricated healthy sample.
    expect(curlInstantQuery('http://127.0.0.1:1/api/v1/query?query=up', 1)).toBeNull();
  });
});

describe('readRolloutMetricsFrom interprets fetched responses', () => {
  it('returns one sample per healthy metric, stamped with the guardrail metric name', () => {
    const responses = new Map<string, PrometheusInstantQuery>([
      ['request-success-rate', successResponse(1751362200, '99.5')],
      ['request-duration-p95-ms', successResponse(1751362200, '412')],
    ]);
    const metrics = readRolloutMetricsFrom(responses, DEFAULT_GUARDRAILS);
    expect(metrics.length).toBe(2);
    expect(metrics.map((m) => m.metric).sort())
      .toEqual(['request-duration-p95-ms', 'request-success-rate']);
    const success = metrics.find((m) => m.metric === 'request-success-rate');
    expect(success?.value).toBe(99.5);
  });

  it('OMITS a metric whose query errored -- absent, never a fabricated zero', () => {
    const responses = new Map<string, PrometheusInstantQuery>([
      ['request-success-rate', errorResponse],
      ['request-duration-p95-ms', successResponse(1751362200, '412')],
    ]);
    const metrics = readRolloutMetricsFrom(responses, DEFAULT_GUARDRAILS);
    expect(metrics.map((m) => m.metric)).toEqual(['request-duration-p95-ms']);
  });

  it('OMITS a metric that returned an empty vector (no series scraped yet)', () => {
    const responses = new Map<string, PrometheusInstantQuery>([
      ['request-success-rate', emptyVector],
      ['request-duration-p95-ms', successResponse(1751362200, '412')],
    ]);
    expect(readRolloutMetricsFrom(responses, DEFAULT_GUARDRAILS).map((m) => m.metric))
      .toEqual(['request-duration-p95-ms']);
  });

  it('OMITS a metric whose sample is NaN rather than coercing it to 0', () => {
    const responses = new Map<string, PrometheusInstantQuery>([
      ['request-success-rate', successResponse(1751362200, 'NaN')],
    ]);
    expect(readRolloutMetricsFrom(responses, DEFAULT_GUARDRAILS)).toEqual([]);
  });

  it('returns an empty RolloutMetrics when nothing was fetched at all', () => {
    const metrics = readRolloutMetricsFrom(new Map(), DEFAULT_GUARDRAILS);
    expect(metrics).toEqual([]);
  });

  it('never invents a metric that was not guarded', () => {
    const responses = new Map<string, PrometheusInstantQuery>([
      ['some-unguarded-metric', successResponse(1751362200, '1')],
    ]);
    expect(readRolloutMetricsFrom(responses, DEFAULT_GUARDRAILS)).toEqual([]);
  });
});
