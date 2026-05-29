// apps/api/src/observability/otel-bootstrap.ts
// Standalone bootstrap entry for `node --import ./dist/observability/otel-bootstrap.js`.
// Reads env vars and starts OTel before any application module is imported.
import { startOtel, shutdownOtel } from './otel.js';

startOtel({
  serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'fleet-api',
  serviceVersion: process.env['npm_package_version'] ?? '0.1.0',
  enabled: process.env['OTEL_ENABLED'] === 'true',
  ...(process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] !== undefined
    ? { endpoint: process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] }
    : {}),
  ...(process.env['OTEL_SAMPLE_RATIO'] !== undefined
    ? { sampleRatio: Number(process.env['OTEL_SAMPLE_RATIO']) }
    : {}),
});

process.on('SIGTERM', () => {
  void (async () => {
    await shutdownOtel();
  })();
});
