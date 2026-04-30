// apps/ops-web/sentry.server.config.ts
import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@fleet/observability';

const dsn = process.env['SENTRY_DSN'];
if (dsn && process.env.NODE_ENV !== 'test') {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1'),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
