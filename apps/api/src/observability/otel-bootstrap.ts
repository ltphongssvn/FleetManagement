// apps/api/src/observability/otel-bootstrap.ts
// Standalone bootstrap entry for `node --import ./dist/observability/otel-bootstrap.js`.
// Validates env vars through the EnvSchema SSOT, then starts OTel before any
// application module is imported.
//
// This file previously read five raw process.env values and validated none:
// Number(process.env.OTEL_SAMPLE_RATIO) passed NaN straight into
// TraceIdRatioBasedSampler, an empty var coerced to 0 and silently disabled all
// tracing, and 5 meant a 500 percent ratio. The ?? fallback in resolveSampleRatio
// could never fire, because the spread only omitted the key when the var was
// undefined -- any SET value, including garbage, reached the sampler.
//
// OtelEnvSchema picks the four OTEL keys from the same EnvSchema that the app
// validates, so the rules cannot drift, while a tracer is not forced to supply
// DATABASE_URL or OIDC config it has no business requiring. Factor III: config is
// declared at the validated boundary, never read raw.
import { startOtel, shutdownOtel } from './otel.js';
import { validateOtelEnv } from '../config/env.config.js';

const env = validateOtelEnv(process.env);

startOtel({
  serviceName: env.OTEL_SERVICE_NAME,
  serviceVersion: process.env['npm_package_version'] ?? '0.1.0',
  enabled: env.OTEL_ENABLED,
  sampleRatio: env.OTEL_SAMPLE_RATIO,
  ...(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT !== undefined
    ? { endpoint: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT }
    : {}),
});

process.on('SIGTERM', () => {
  void (async () => {
    await shutdownOtel();
  })();
});
