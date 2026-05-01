// apps/api/src/observability/sentry-bootstrap.ts
import * as Sentry from '@sentry/nestjs';
import { scrubEvent } from '@fleet/observability';

export function parseSampleRate(raw: string | undefined): number {
  const n = Number(raw ?? '0.1');
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.1;
  return n;
}

export function initSentry(): void {
  if (process.env['NODE_ENV'] === 'test') return;
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: parseSampleRate(process.env['SENTRY_TRACES_SAMPLE_RATE']),
    release: process.env['npm_package_version'],
    sendDefaultPii: false,
    beforeSend: scrubEvent as never,
  });
}
