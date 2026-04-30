// apps/api/src/observability/sentry-bootstrap.ts
import * as Sentry from '@sentry/node';

export function initSentry(): void {
  if (process.env['NODE_ENV'] === 'test') return;
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    release: process.env['npm_package_version'],
  });
}
