// apps/api/test/otel-env.test.ts
// RED-first: otel-bootstrap.ts reads five raw process.env values and validates
// none of them, while EnvSchema already declares all four OTEL keys with the
// exact rules bootstrap re-implements by hand. Axis-1 fix-trigger (1) -- env
// vars are a trust boundary -- and Axis-2 trigger (2) -- the same contract is
// stated twice, free to drift.
//
// Concretely, bootstrap does: sampleRatio: Number(process.env.OTEL_SAMPLE_RATIO).
// The spread only omits the key when the var is undefined, so any SET value
// reaches new TraceIdRatioBasedSampler() unchecked and the ?? DEFAULT fallback
// in resolveSampleRatio can never fire:
//   OTEL_SAMPLE_RATIO=abc -> NaN sampler
//   OTEL_SAMPLE_RATIO=    -> Number() is 0 -> tracing silently OFF
//   OTEL_SAMPLE_RATIO=5   -> a 500 percent ratio
//
// Bootstrap cannot import the full app config: it loads via node --import before
// any application module. RebuildEnvSchema (env.config.ts) already solved that
// exact shape for the rebuild CLI -- pick a scoped subset from the SAME SSOT so
// it can never drift. OtelEnvSchema mirrors that precedent.
import { describe, it, expect } from 'vitest';
import { OtelEnvSchema, validateOtelEnv, EnvSchema } from '../src/config/env.config.js';

describe('OtelEnvSchema derives from the EnvSchema SSOT', () => {
  it('carries exactly the four OTEL keys the bootstrap needs', () => {
    expect(Object.keys(OtelEnvSchema.shape).sort()).toEqual([
      'OTEL_ENABLED',
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      'OTEL_SAMPLE_RATIO',
      'OTEL_SERVICE_NAME',
    ]);
  });

  it('is picked from EnvSchema, so the sample-ratio rule cannot drift', () => {
    expect(OtelEnvSchema.shape.OTEL_SAMPLE_RATIO).toBe(EnvSchema.shape.OTEL_SAMPLE_RATIO);
  });

  it('does not demand unrelated config a bootstrap has no business requiring', () => {
    expect(Object.keys(OtelEnvSchema.shape)).not.toContain('DATABASE_URL');
    expect(Object.keys(OtelEnvSchema.shape)).not.toContain('OIDC_ISSUER');
  });
});

describe('validateOtelEnv applies the canonical defaults', () => {
  it('defaults an empty environment to disabled tracing at full ratio', () => {
    const env = validateOtelEnv({});
    expect(env.OTEL_ENABLED).toBe(false);
    expect(env.OTEL_SAMPLE_RATIO).toBe(1.0);
    expect(env.OTEL_SERVICE_NAME).toBe('fleet-api');
  });

  it('coerces the enabled flag to a boolean rather than comparing strings', () => {
    expect(validateOtelEnv({ OTEL_ENABLED: 'true' }).OTEL_ENABLED).toBe(true);
    expect(validateOtelEnv({ OTEL_ENABLED: 'false' }).OTEL_ENABLED).toBe(false);
  });

  it('accepts a valid partial sample ratio', () => {
    expect(validateOtelEnv({ OTEL_SAMPLE_RATIO: '0.05' }).OTEL_SAMPLE_RATIO).toBe(0.05);
  });

  it('preserves an explicit zero ratio, which means sample nothing', () => {
    expect(validateOtelEnv({ OTEL_SAMPLE_RATIO: '0' }).OTEL_SAMPLE_RATIO).toBe(0);
  });
});

describe('validateOtelEnv rejects what the raw bootstrap accepted', () => {
  it('rejects a non-numeric ratio instead of building a NaN sampler', () => {
    expect(() => validateOtelEnv({ OTEL_SAMPLE_RATIO: 'abc' })).toThrow();
  });

  it('rejects a ratio above 1, which is not a percentage the sampler accepts', () => {
    expect(() => validateOtelEnv({ OTEL_SAMPLE_RATIO: '5' })).toThrow();
  });

  it('rejects a negative ratio', () => {
    expect(() => validateOtelEnv({ OTEL_SAMPLE_RATIO: '-1' })).toThrow();
  });

  it('rejects an enabled flag that is not true or false', () => {
    expect(() => validateOtelEnv({ OTEL_ENABLED: 'yes' })).toThrow();
  });

  it('rejects a malformed exporter endpoint rather than passing it to the exporter', () => {
    expect(() => validateOtelEnv({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'not-a-url' })).toThrow();
  });

  it('names the offending key so a misconfigured deploy fails loudly', () => {
    expect(() => validateOtelEnv({ OTEL_SAMPLE_RATIO: 'abc' })).toThrow(/OTEL_SAMPLE_RATIO/);
  });
});
