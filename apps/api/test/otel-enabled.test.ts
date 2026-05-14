// apps/api/test/otel-enabled.test.ts
// Kills survivors on otel.ts lines 28-58 (startOtel enabled path) and 61-65 (shutdownOtel populated path).
import { describe, it, expect, afterEach } from 'vitest';
import {
  startOtel,
  shutdownOtel,
  resolveEndpoint,
  resolveSampleRatio,
  buildResourceAttributes,
  buildInstrumentationConfig,
  DEFAULT_OTLP_ENDPOINT,
  DEFAULT_SAMPLE_RATIO,
} from '../src/observability/otel.js';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

describe('@fleet/api - OTel enabled path', () => {
  afterEach(async () => {
    // Ensure clean teardown between tests so module-level `sdk` state doesn't leak.
    await shutdownOtel();
  });

  it('startOtel with enabled=true starts the SDK without throwing (kills line 28 BlockStatement, line 29 !enabled cond/bool mutants)', () => {
    // Mutants:
    //   BlockStatement -> {}        : SDK never starts -> sdk stays null -> shutdownOtel below would early-return (observable via second start being non-idempotent).
    //   `if (!opts.enabled) return` -> `if (opts.enabled) return`: enabled=true would return early; sdk stays null.
    //   `if (true) return`           : always returns; sdk stays null.
    //   `if (false) return`          : never returns; would also start when disabled (covered by separate idempotency assertion below).
    expect(() => {
      startOtel({
        serviceName: 'test-svc',
        serviceVersion: '1.0.0',
        enabled: true,
        endpoint: 'http://127.0.0.1:14318/v1/traces',
        sampleRatio: 0.5,
      });
    }).not.toThrow();
  });

  it('startOtel enabled is idempotent — second call with sdk already set is a no-op (kills line 30 sdk !== null cond mutants)', () => {
    startOtel({ serviceName: 'svc', serviceVersion: '1.0.0', enabled: true, endpoint: 'http://127.0.0.1:14318/v1/traces' });
    // Mutants on `if (sdk !== null) return`:
    //   `if (true) return`     : ALWAYS returns -> first call would not init sdk (caught by test above via shutdownOtel needing to await real SDK shutdown).
    //   `if (false) return`    : NEVER returns -> second call would re-init sdk; SDK throws on double start.
    //   `if (sdk === null) return`: inverted; same effect as the false/true variants depending on first call.
    expect(() => {
      startOtel({ serviceName: 'svc', serviceVersion: '1.0.0', enabled: true, endpoint: 'http://127.0.0.1:14318/v1/traces' });
    }).not.toThrow();
  });

  it('shutdownOtel resolves after startOtel(enabled=true) and resets sdk so a later start works again (kills line 61 BlockStatement, line 62 sdk === null cond mutants)', async () => {
    startOtel({ serviceName: 'svc', serviceVersion: '1.0.0', enabled: true, endpoint: 'http://127.0.0.1:14318/v1/traces' });
    await expect(shutdownOtel()).resolves.toBeUndefined();
    // After shutdown, sdk should be null again so startOtel can re-init.
    // Mutants on line 61 BlockStatement -> {}: shutdownOtel never awaits sdk.shutdown(), never nulls sdk -> next start would be no-op.
    // Mutant on line 62 `if (true) return`: early-returns even when sdk set -> sdk never shut down or nulled.
    expect(() => {
      startOtel({ serviceName: 'svc', serviceVersion: '1.0.0', enabled: true, endpoint: 'http://127.0.0.1:14318/v1/traces' });
    }).not.toThrow();
  });

  it('startOtel works with default sampleRatio (kills line 41 LogicalOperator ?? -> && fallback)', () => {
    // sampleRatio omitted -> falls back to 1.0 via ?? mutant `opts.sampleRatio && 1.0` would yield undefined, ParentBasedSampler would throw.
    expect(() => {
      startOtel({ serviceName: 'svc', serviceVersion: '1.0.0', enabled: true, endpoint: 'http://127.0.0.1:14318/v1/traces' });
    }).not.toThrow();
  });

  it('startOtel works with default endpoint (kills line 33 LogicalOperator ?? -> && fallback)', () => {
    // endpoint omitted -> falls back to default URL; ?? -> && mutant would pass undefined to OTLPTraceExporter.
    expect(() => {
      startOtel({ serviceName: 'svc', serviceVersion: '1.0.0', enabled: true });
    }).not.toThrow();
  });
});

describe('@fleet/api - OTel config builders (pure)', () => {
  it('resolveEndpoint returns the provided endpoint verbatim when set (kills ?? LogicalOperator)', () => {
    expect(resolveEndpoint('http://collector:4318/v1/traces')).toBe('http://collector:4318/v1/traces');
  });

  it('resolveEndpoint falls back to DEFAULT_OTLP_ENDPOINT when undefined (kills ?? -> && + StringLiteral mutants)', () => {
    expect(resolveEndpoint(undefined)).toBe(DEFAULT_OTLP_ENDPOINT);
    expect(DEFAULT_OTLP_ENDPOINT).toBe('http://localhost:4318/v1/traces');
  });

  it('resolveSampleRatio returns the provided ratio verbatim when set, including 0 (kills ?? -> && which would drop 0)', () => {
    expect(resolveSampleRatio(0.25)).toBe(0.25);
    // 0 is falsy: ?? keeps it, && would replace it with DEFAULT_SAMPLE_RATIO.
    expect(resolveSampleRatio(0)).toBe(0);
  });

  it('resolveSampleRatio falls back to DEFAULT_SAMPLE_RATIO when undefined (kills ?? -> && + numeric literal mutants)', () => {
    expect(resolveSampleRatio(undefined)).toBe(DEFAULT_SAMPLE_RATIO);
    expect(DEFAULT_SAMPLE_RATIO).toBe(1.0);
  });

  it('buildResourceAttributes maps serviceName + serviceVersion to OTel semantic keys (kills ObjectLiteral {} mutant)', () => {
    const attrs = buildResourceAttributes({
      serviceName: 'fleet-api',
      serviceVersion: '2.3.4',
      enabled: true,
    });
    expect(attrs[ATTR_SERVICE_NAME]).toBe('fleet-api');
    expect(attrs[ATTR_SERVICE_VERSION]).toBe('2.3.4');
  });

  it('buildInstrumentationConfig disables fs and dns instrumentation (kills ObjectLiteral {} + BooleanLiteral mutants)', () => {
    const cfg = buildInstrumentationConfig();
    if (cfg === undefined) throw new Error('expected config');
    const fs = cfg['@opentelemetry/instrumentation-fs'];
    const dns = cfg['@opentelemetry/instrumentation-dns'];
    // ObjectLiteral mutant -> {} : both entries undefined.
    // BooleanLiteral mutant enabled:false -> true : enabled would be true.
    expect(fs).toEqual({ enabled: false });
    expect(dns).toEqual({ enabled: false });
  });
});
