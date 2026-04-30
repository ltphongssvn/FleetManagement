// apps/ops-web/sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];
if (dsn && process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_SAMPLE_RATE'] ?? '0.1'),
  });
}
