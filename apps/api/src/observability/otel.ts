// apps/api/src/observability/otel.ts
// OpenTelemetry SDK initialization per Frozen Stack PDF "Observability".
// Loaded explicitly via main.ts before NestFactory.create.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export interface OtelOptions {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly endpoint?: string;
  readonly enabled: boolean;
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
  sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy auto-instrumentations; opt-in important ones.
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
