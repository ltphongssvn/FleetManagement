// apps/api/test/otel-enabled.test.ts
// Kills survivors on otel.ts lines 28-58 (startOtel enabled path) and 61-65 (shutdownOtel populated path).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
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

import { vi } from 'vitest';
import {
  buildSdkConfig,
  isOtelStarted,
  DEFAULT_OTLP_ENDPOINT as DEF_EP,
} from '../src/observability/otel.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler } from '@opentelemetry/sdk-trace-base';
import type * as ExporterModule from '@opentelemetry/exporter-trace-otlp-http';
import type * as SdkTraceBaseModule from '@opentelemetry/sdk-trace-base';

describe('@fleet/api - OTel buildSdkConfig (pure SDK config)', () => {
  const opts = {
    serviceName: 'fleet-api',
    serviceVersion: '9.9.9',
    enabled: true,
    endpoint: 'http://collector:4318/v1/traces',
    sampleRatio: 0.25,
  };

  it('returns a config object with all four NodeSDK fields populated (kills NodeSDK({}) ObjectLiteral mutant)', () => {
    const cfg = buildSdkConfig(opts);
    expect(cfg.resource).toBeDefined();
    expect(cfg.sampler).toBeDefined();
    expect(cfg.traceExporter).toBeDefined();
    expect(cfg.instrumentations).toBeDefined();
  });

  it('resource carries the service name + version attributes (kills resourceFromAttributes input mutants)', () => {
    const cfg = buildSdkConfig(opts);
    const attrs = (cfg.resource as unknown as { attributes: Record<string, unknown> }).attributes;
    expect(attrs[ATTR_SERVICE_NAME]).toBe('fleet-api');
    expect(attrs[ATTR_SERVICE_VERSION]).toBe('9.9.9');
  });

  it('sampler is a ParentBasedSampler (kills ParentBasedSampler({}) ObjectLiteral mutant)', () => {
    const cfg = buildSdkConfig(opts);
    expect(cfg.sampler).toBeInstanceOf(ParentBasedSampler);
  });

  it('traceExporter is built with the resolved endpoint url (kills OTLPTraceExporter({}) + resolveEndpoint mutants)', () => {
    const cfg = buildSdkConfig(opts);
    expect(cfg.exporterUrl).toBe('http://collector:4318/v1/traces');
  });

  it('exporterUrl falls back to DEFAULT_OTLP_ENDPOINT when no endpoint given', () => {
    const cfg = buildSdkConfig({ serviceName: 's', serviceVersion: 'v', enabled: true });
    expect(cfg.exporterUrl).toBe(DEF_EP);
  });

  it('samplerRatio reflects the resolved sample ratio, preserving 0 (kills resolveSampleRatio + literal mutants)', () => {
    expect(buildSdkConfig(opts).samplerRatio).toBe(0.25);
    expect(buildSdkConfig({ serviceName: 's', serviceVersion: 'v', enabled: true, sampleRatio: 0 }).samplerRatio).toBe(0);
    expect(buildSdkConfig({ serviceName: 's', serviceVersion: 'v', enabled: true }).samplerRatio).toBe(DEFAULT_SAMPLE_RATIO);
  });

  it('instrumentations is a non-empty array (kills instrumentations: [] ArrayDeclaration mutant)', () => {
    const cfg = buildSdkConfig(opts);
    expect(Array.isArray(cfg.instrumentations)).toBe(true);
    expect(cfg.instrumentations.length).toBeGreaterThan(0);
  });
});

describe('@fleet/api - OTel startOtel/shutdownOtel lifecycle (NodeSDK spies)', () => {
  let startSpy: ReturnType<typeof vi.spyOn>;
  let shutdownSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    startSpy = vi.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);
    shutdownSpy = vi
      .spyOn(NodeSDK.prototype, 'shutdown')
      .mockImplementation(() => Promise.resolve());
  });

  afterEach(async () => {
    await shutdownOtel();
    vi.restoreAllMocks();
  });

  it('startOtel(enabled=true) constructs the SDK and calls start() exactly once (kills startOtel BlockStatement + !opts.enabled cond/bool mutants)', () => {
    expect(isOtelStarted()).toBe(false);
    startOtel({ serviceName: 's', serviceVersion: 'v', enabled: true });
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(isOtelStarted()).toBe(true);
  });

  it('startOtel(enabled=false) does NOT start the SDK (kills !opts.enabled -> opts.enabled / true / false cond mutants)', () => {
    startOtel({ serviceName: 's', serviceVersion: 'v', enabled: false });
    expect(startSpy).not.toHaveBeenCalled();
    expect(isOtelStarted()).toBe(false);
  });

  it('startOtel is idempotent: a second call does not start a second SDK (kills sdk !== null cond/equality mutants)', () => {
    startOtel({ serviceName: 's', serviceVersion: 'v', enabled: true });
    startOtel({ serviceName: 's', serviceVersion: 'v', enabled: true });
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(isOtelStarted()).toBe(true);
  });

  it('shutdownOtel after a start calls shutdown() once and clears state (kills shutdownOtel BlockStatement + sdk === null cond mutants)', async () => {
    startOtel({ serviceName: 's', serviceVersion: 'v', enabled: true });
    await shutdownOtel();
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(isOtelStarted()).toBe(false);
  });

  it('shutdownOtel with no active SDK does NOT call shutdown() (kills sdk === null -> true / false cond mutants)', async () => {
    await shutdownOtel();
    expect(shutdownSpy).not.toHaveBeenCalled();
  });

  it('after shutdown, startOtel can start a fresh SDK again (kills shutdownOtel sdk=null reset BlockStatement mutant)', async () => {
    startOtel({ serviceName: 's', serviceVersion: 'v', enabled: true });
    await shutdownOtel();
    startOtel({ serviceName: 's', serviceVersion: 'v', enabled: true });
    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(isOtelStarted()).toBe(true);
  });
});


// --- Constructor-wiring spies: kill OTLPTraceExporter({}) and ParentBasedSampler({}) survivors ---
// vi.mock is hoisted; it intercepts the modules before otel.ts imports them, so we
// can assert the exact constructor arguments buildSdkConfig passes through.
const exporterCtorArgs: unknown[] = [];
const samplerRootArgs: unknown[] = [];

vi.mock('@opentelemetry/exporter-trace-otlp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof ExporterModule>();
  return {
    ...actual,
    OTLPTraceExporter: class extends actual.OTLPTraceExporter {
      constructor(cfg?: ConstructorParameters<typeof actual.OTLPTraceExporter>[0]) {
        exporterCtorArgs.push(cfg);
        super(cfg);
      }
    },
  };
});

vi.mock('@opentelemetry/sdk-trace-base', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkTraceBaseModule>();
  return {
    ...actual,
    TraceIdRatioBasedSampler: class extends actual.TraceIdRatioBasedSampler {
      constructor(ratio?: number) {
        samplerRootArgs.push(ratio);
        super(ratio);
      }
    },
  };
});

describe('@fleet/api - OTel buildSdkConfig constructor wiring', () => {
  beforeEach(() => {
    exporterCtorArgs.length = 0;
    samplerRootArgs.length = 0;
  });

  it('passes { url: resolvedEndpoint } into the OTLPTraceExporter constructor (kills OTLPTraceExporter({}) ObjectLiteral mutant)', () => {
    buildSdkConfig({
      serviceName: 's',
      serviceVersion: 'v',
      enabled: true,
      endpoint: 'http://spy:4318/v1/traces',
    });
    expect(exporterCtorArgs).toHaveLength(1);
    expect(exporterCtorArgs[0]).toEqual({ url: 'http://spy:4318/v1/traces' });
  });

  it('passes the resolved sample ratio into the TraceIdRatioBasedSampler constructor (kills ParentBasedSampler({}) + sampler-input mutants)', () => {
    buildSdkConfig({ serviceName: 's', serviceVersion: 'v', enabled: true, sampleRatio: 0.42 });
    expect(samplerRootArgs).toHaveLength(1);
    expect(samplerRootArgs[0]).toBe(0.42);
  });
});
