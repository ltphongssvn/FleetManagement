// apps/api/test/prometheus-env.test.ts
// RED-first: the progressive-delivery metrics reader needs a Prometheus base URL,
// and Factor III says config is declared at the validated boundary rather than
// read raw at the call site. Reading process.env.PROMETHEUS_BASE_URL directly in
// the adapter would repeat exactly the defect otel-bootstrap.ts had: an unset var
// becomes undefined in a template, a typo becomes a request to a nonsense host,
// and nothing fails until a canary silently cannot be evaluated.
//
// PrometheusEnvSchema mirrors the RebuildEnvSchema / OtelEnvSchema precedent in
// env.config.ts: pick a scoped subset from the SAME EnvSchema SSOT so the rule
// can never drift, and expose a validator that names the offending key.
//
// The var is OPTIONAL on purpose, fail-safe dormant like
// KEYCLOAK_MONITOR_CLIENT_SECRET and the webhook secrets: an environment that has
// not wired Prometheus must still boot. Unset means the metrics reader stays
// inert and every guarded metric reads as ABSENT, which the analysis engine routes
// to the inconclusive budget -- a rollout that cannot be measured is never
// promoted, and never mistaken for healthy.
import { describe, it, expect } from 'vitest';
import {
  PrometheusEnvSchema,
  validatePrometheusEnv,
  EnvSchema,
} from '../src/config/env.config.js';

describe('PrometheusEnvSchema derives from the EnvSchema SSOT', () => {
  it('carries exactly the Prometheus key the metrics reader needs', () => {
    expect(Object.keys(PrometheusEnvSchema.shape)).toEqual(['PROMETHEUS_BASE_URL']);
  });

  it('is picked from EnvSchema, so the URL rule cannot drift', () => {
    expect(PrometheusEnvSchema.shape.PROMETHEUS_BASE_URL).toBe(
      EnvSchema.shape.PROMETHEUS_BASE_URL,
    );
  });

  it('does not demand unrelated config a metrics reader has no business requiring', () => {
    expect(Object.keys(PrometheusEnvSchema.shape)).not.toContain('DATABASE_URL');
    expect(Object.keys(PrometheusEnvSchema.shape)).not.toContain('OIDC_ISSUER');
  });
});

describe('validatePrometheusEnv is fail-safe dormant when unset', () => {
  it('accepts an empty environment rather than blocking boot', () => {
    expect(validatePrometheusEnv({}).PROMETHEUS_BASE_URL).toBeUndefined();
  });

  it('accepts a configured base URL', () => {
    const env = validatePrometheusEnv({ PROMETHEUS_BASE_URL: 'http://prometheus:9090' });
    expect(env.PROMETHEUS_BASE_URL).toBe('http://prometheus:9090');
  });

  it('accepts an https endpoint', () => {
    const env = validatePrometheusEnv({ PROMETHEUS_BASE_URL: 'https://metrics.example.com' });
    expect(env.PROMETHEUS_BASE_URL).toBe('https://metrics.example.com');
  });
});

describe('validatePrometheusEnv rejects what a raw read would accept', () => {
  it('rejects a malformed URL instead of querying a nonsense host', () => {
    expect(() => validatePrometheusEnv({ PROMETHEUS_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('rejects an empty string, which a raw read would treat as configured', () => {
    expect(() => validatePrometheusEnv({ PROMETHEUS_BASE_URL: '' })).toThrow();
  });

  it('names the offending key so a misconfigured deploy fails loudly', () => {
    expect(() => validatePrometheusEnv({ PROMETHEUS_BASE_URL: 'nope' })).toThrow(
      /PROMETHEUS_BASE_URL/,
    );
  });
});
