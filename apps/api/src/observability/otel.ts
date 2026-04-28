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

export interface OtelOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly endpoint?: string;
  readonly enabled: boolean;
  /** Head-based sample ratio. 1.0 = trace everything; 0.05 = 5% sample. */
  readonly sampleRatio?: number;
}

export function startOtel(opts: OtelOptions): void {
  if (!opts.enabled) return;
  if (sdk !== null) return;

  const exporter = new OTLPTraceExporter({
    url: opts.endpoint ?? 'http://localhost:4318/v1/traces',
  });

  const resource: Resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.serviceVersion,
  });

  const ratio = opts.sampleRatio ?? 1.0;
  const sampler: Sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(ratio),
  });

  sdk = new NodeSDK({
    resource,
    sampler,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
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
