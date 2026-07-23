// apps/api/test/prometheus-metrics-adapter.test.ts
// RED-first test for the Prometheus metrics adapter: the boundary that turns a
// Prometheus /api/v1/query instant-vector response into the validated
// RolloutMetrics the analysis engine consumes. Pure schema + pure transform;
// the HTTP call is isolated in main()-only helpers, mirroring
// scripts/ci/ci-minutes-fetch.ts (wire schemas and the join are exported and
// unit-tested; curl lives in side-effecting helpers).
//
// Grounded in the Prometheus HTTP API docs. An instant query returns:
//   { status: success | error,
//     data: { resultType: vector, result: [ { metric: {labels}, value: [ ts, str ] } ] },
//     errorType?, error? }
// Three facts drive the contract:
//   1. the sample value is a STRING ( [1435781451.781, "1"] ), so it must be
//      coerced, and that coercion is where NaN enters.
//   2. the timestamp is unix SECONDS as a float; MetricSampleSchema requires ISO
//      observedAt and rejects epoch numbers, so the adapter converts explicitly.
//   3. status:error and an empty result[] are the no-data cases. They map to
//      ABSENT -- the series is simply omitted from RolloutMetrics -- never to a
//      fabricated healthy sample. The engine then routes an absent guarded metric
//      to the inconclusive budget. This is the confident-zero fix at the wire:
//      no data is never silently a pass.
import { describe, it, expect } from 'vitest';
import {
  PrometheusInstantQuerySchema,
  toMetricSample,
  toRolloutMetrics,
  UNIX_SECONDS_TO_ISO_TESTS,
  buildInstantQueryUrl,
  type InstantResultRow,
} from '../src/observability/prometheus-metrics-adapter.js';

const okVector = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [
      {
        metric: { __name__: 'request_success_rate', job: 'api' },
        value: [1435781451.781, '99.7'],
      },
    ],
  },
};
const emptyVector = { status: 'success', data: { resultType: 'vector', result: [] } };
const errorResponse = { status: 'error', errorType: 'bad_data', error: 'parse error' };

describe('PrometheusInstantQuerySchema: accepts the documented wire shape', () => {
  it('parses a success vector with one sample', () => {
    const parsed = PrometheusInstantQuerySchema.parse(okVector);
    expect(parsed.status).toBe('success');
    expect(parsed.data?.result).toHaveLength(1);
  });

  it('parses an empty success vector', () => {
    expect(PrometheusInstantQuerySchema.parse(emptyVector).data?.result).toHaveLength(0);
  });

  it('parses an error response with no data block', () => {
    const parsed = PrometheusInstantQuerySchema.parse(errorResponse);
    expect(parsed.status).toBe('error');
    expect(parsed.data).toBeUndefined();
  });

  it('rejects an unknown status rather than trusting it', () => {
    expect(() => PrometheusInstantQuerySchema.parse({ status: 'partial' })).toThrow();
  });

  it('rejects a value tuple whose sample is not a string, since Prometheus sends strings', () => {
    const bad = {
      status: 'success',
      data: { resultType: 'vector', result: [{ metric: {}, value: [1, 2] }] },
    };
    expect(() => PrometheusInstantQuerySchema.parse(bad)).toThrow();
  });
});

describe('toMetricSample: converts one Prometheus row to a MetricSample', () => {
  it('coerces the string value to a finite number', () => {
    const row: InstantResultRow = { metric: {}, value: [1435781451.781, '99.7'] };
    const sample = toMetricSample('request-success-rate', row);
    expect(sample?.value).toBe(99.7);
  });

  it('converts the unix-seconds timestamp to an ISO observedAt the metric schema accepts', () => {
    const row: InstantResultRow = { metric: {}, value: [1435781451.781, '99.7'] };
    const sample = toMetricSample('request-success-rate', row);
    expect(sample?.observedAt).toBe(new Date(1435781451.781 * 1000).toISOString());
  });

  it('stamps the caller metric name, not the Prometheus __name__ label', () => {
    const row: InstantResultRow = { metric: { __name__: 'promql_internal' }, value: [1, '1'] };
    expect(toMetricSample('request-success-rate', row)?.metric).toBe('request-success-rate');
  });

  it('returns null for a NaN sample, so no fabricated reading reaches the engine', () => {
    const row: InstantResultRow = { metric: {}, value: [1, 'NaN'] };
    expect(toMetricSample('request-success-rate', row)).toBeNull();
  });

  it('returns null for a non-numeric sample', () => {
    const row: InstantResultRow = { metric: {}, value: [1, 'down'] };
    expect(toMetricSample('request-success-rate', row)).toBeNull();
  });

  it('returns null for a positive-infinity sample', () => {
    const row: InstantResultRow = { metric: {}, value: [1, 'Inf'] };
    expect(toMetricSample('request-success-rate', row)).toBeNull();
  });

  it('returns null when the value is finite but the sample fails the metric schema', () => {
    // Empty metric name passes the finite-number guard but violates
    // MetricSampleSchema metric.min(1), exercising the schema-reject path.
    const row: InstantResultRow = { metric: {}, value: [1, '99.9'] };
    expect(toMetricSample('', row)).toBeNull();
  });
});

describe('the unix-to-ISO conversion is a pure table', () => {
  it.each(UNIX_SECONDS_TO_ISO_TESTS)('$seconds -> $iso', ({ seconds, iso }) => {
    expect(new Date(seconds * 1000).toISOString()).toBe(iso);
  });
});

describe('toRolloutMetrics: omits absent series, never fabricates a reading', () => {
  it('includes a finite sample for a healthy metric', () => {
    const responses = new Map([
      [
        'request-success-rate',
        PrometheusInstantQuerySchema.parse(okVector),
      ],
    ]);
    const out = toRolloutMetrics(responses, ['request-success-rate']);
    expect(out).toHaveLength(1);
    expect(out[0]?.metric).toBe('request-success-rate');
    expect(out[0]?.value).toBe(99.7);
  });

  it('omits a metric whose query is missing from the response map', () => {
    const out = toRolloutMetrics(new Map(), ['request-success-rate']);
    expect(out).toHaveLength(0);
  });

  it('omits a metric whose query returned an error response', () => {
    const responses = new Map([
      ['request-success-rate', PrometheusInstantQuerySchema.parse(errorResponse)],
    ]);
    expect(toRolloutMetrics(responses, ['request-success-rate'])).toHaveLength(0);
  });

  it('omits a metric whose query returned an empty vector', () => {
    const responses = new Map([
      ['request-success-rate', PrometheusInstantQuerySchema.parse(emptyVector)],
    ]);
    expect(toRolloutMetrics(responses, ['request-success-rate'])).toHaveLength(0);
  });

  it('omits a metric whose sample is non-finite, rather than emitting a fake zero', () => {
    const nanVector = PrometheusInstantQuerySchema.parse({
      status: 'success',
      data: { resultType: 'vector', result: [{ metric: {}, value: [1, 'NaN'] }] },
    });
    const responses = new Map([['request-success-rate', nanVector]]);
    expect(toRolloutMetrics(responses, ['request-success-rate'])).toHaveLength(0);
  });

  it('omits a success response that carries no data block at all', () => {
    const noData = PrometheusInstantQuerySchema.parse({ status: 'success' });
    const responses = new Map([['request-success-rate', noData]]);
    expect(toRolloutMetrics(responses, ['request-success-rate'])).toHaveLength(0);
  });
  it('returns only the present metrics when some are absent and some healthy', () => {
    const responses = new Map([
      ['request-success-rate', PrometheusInstantQuerySchema.parse(okVector)],
      ['request-duration-p95-ms', PrometheusInstantQuerySchema.parse(emptyVector)],
    ]);
    const out = toRolloutMetrics(responses, [
      'request-success-rate',
      'request-duration-p95-ms',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.metric).toBe('request-success-rate');
  });
});

describe('buildInstantQueryUrl: encodes PromQL so the query survives the wire', () => {
  it('targets the documented instant-query endpoint', () => {
    const url = buildInstantQueryUrl('http://prometheus:9090', 'up');
    expect(url.startsWith('http://prometheus:9090/api/v1/query?')).toBe(true);
  });

  it('percent-encodes a PromQL expression containing spaces and braces', () => {
    // A real guardrail query. Unencoded braces and spaces would be mangled or
    // silently truncated by the server, and the reader would see no data --
    // which the engine would then read as inconclusive rather than as the bug
    // it actually is. Encoding is therefore part of the contract, not cosmetic.
    const promQL = 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))';
    const url = buildInstantQueryUrl('http://prometheus:9090', promQL);
    // URLSearchParams uses form encoding (space -> plus), not percent encoding.
    // Both are valid query-string encodings and Prometheus accepts either; what
    // matters is that no raw space, brace or bracket reaches the wire and that the
    // expression survives a round trip intact, which the next test pins.
    expect(url).not.toContain(' ');
    expect(url).not.toContain('[');
    expect(new URL(url).searchParams.get('query')).toBe(promQL);
  });

  it('round-trips the expression through URL parsing unchanged', () => {
    const promQL = 'sum(rate(http_requests_total{status=~"5.."}[5m]))';
    const parsed = new URL(buildInstantQueryUrl('http://prometheus:9090', promQL));
    expect(parsed.searchParams.get('query')).toBe(promQL);
  });

  it('does not double up the slash when the base URL has a trailing one', () => {
    const url = buildInstantQueryUrl('http://prometheus:9090/', 'up');
    expect(url).not.toContain('//api');
  });
});
