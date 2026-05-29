// apps/api/src/observability/otel.ts
// OpenTelemetry SDK initialization per Frozen Stack PDF "Observability".
// Loaded via `node --import ./dist/observability/otel-bootstrap.js` so the SDK
// runs before any application module — auto-instrumentations require this.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from '@opentelemetry/sdk-trace-base';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

let sdk: NodeSDK | null = null;

/** Default OTLP HTTP traces endpoint when none is configured. */
export const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
/** Default head-based sample ratio: trace everything. */
export const DEFAULT_SAMPLE_RATIO = 1.0;

export interface OtelOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly endpoint?: string;
  readonly enabled: boolean;
  /** Head-based sample ratio. 1.0 = trace everything; 0.05 = 5% sample. */
  readonly sampleRatio?: number;
}

/** Resolve the OTLP endpoint, falling back to the default when unset. */
export function resolveEndpoint(endpoint?: string): string {
  return endpoint ?? DEFAULT_OTLP_ENDPOINT;
}

/** Resolve the sample ratio, falling back to the default when unset. Preserves 0. */
export function resolveSampleRatio(sampleRatio?: number): number {
  return sampleRatio ?? DEFAULT_SAMPLE_RATIO;
}

/** Build the OTel semantic-convention resource attribute map. */
export function buildResourceAttributes(opts: OtelOptions): Record<string, string> {
  return {
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.serviceVersion,
  };
}

/** Build the auto-instrumentation config: fs and dns instrumentation disabled. */
export function buildInstrumentationConfig(): Parameters<typeof getNodeAutoInstrumentations>[0] {
  return {
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
  };
}

/** Pure, inspectable description of the NodeSDK construction inputs. */
export interface SdkConfig {
  readonly resource: Resource;
  readonly sampler: Sampler;
  readonly traceExporter: OTLPTraceExporter;
  readonly instrumentations: ReturnType<typeof getNodeAutoInstrumentations>[];
  /** Resolved OTLP endpoint url the exporter was constructed with. */
  readonly exporterUrl: string;
  /** Resolved head-based sample ratio the sampler was constructed with. */
  readonly samplerRatio: number;
}

/**
 * Build the NodeSDK config object from options. Pure: constructs no SDK and
 * starts nothing, so tests can assert on the returned shape directly.
 */
export function buildSdkConfig(opts: OtelOptions): SdkConfig {
  const exporterUrl = resolveEndpoint(opts.endpoint);
  const samplerRatio = resolveSampleRatio(opts.sampleRatio);
  return {
    resource: resourceFromAttributes(buildResourceAttributes(opts)),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplerRatio),
    }),
    traceExporter: new OTLPTraceExporter({ url: exporterUrl }),
    instrumentations: [getNodeAutoInstrumentations(buildInstrumentationConfig())],
    exporterUrl,
    samplerRatio,
  };
}

function buildSdk(opts: OtelOptions): NodeSDK {
  return new NodeSDK(buildSdkConfig(opts));
}

export function startOtel(opts: OtelOptions): void {
  if (!opts.enabled) return;
  if (sdk !== null) return;
  sdk = buildSdk(opts);
  sdk.start();
}

/** True when an SDK instance is currently active (started, not yet shut down). */
export function isOtelStarted(): boolean {
  return sdk !== null;
}

export async function shutdownOtel(): Promise<void> {
  if (sdk === null) return;
  await sdk.shutdown();
  sdk = null;
}

/** Attach domain correlation IDs to the active span. No-op if OTel disabled. */
export function tagActiveSpan(attrs: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [k, v] of Object.entries(attrs)) {
    span.setAttribute(`fleet.${k}`, v);
  }
}

/** Mark active span as failed with a reason code. */
export function recordSpanFailure(reasonCode: string, message?: string): void {
  const span: Span | undefined = trace.getActiveSpan();
  if (!span) return;
  span.setStatus({ code: SpanStatusCode.ERROR, message: message ?? reasonCode });
  span.setAttribute('fleet.failure.code', reasonCode);
}
