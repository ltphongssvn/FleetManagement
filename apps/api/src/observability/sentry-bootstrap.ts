// apps/api/src/observability/sentry-bootstrap.ts
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from '@fleet/observability';

export function initSentry(): void {
  if (process.env['NODE_ENV'] === 'test') return;
  const result = buildSentryOptions({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: process.env['SENTRY_TRACES_SAMPLE_RATE'],
    release: process.env['npm_package_version'],
  });
  if (!result.options) return;
  Sentry.init(result.options as never);
}

// Re-exported for legacy test compatibility (covers parseSampleRate via factory).
export { parseTracesSampleRate as parseSampleRate } from '@fleet/observability';
