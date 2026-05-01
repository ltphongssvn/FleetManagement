// apps/ops-web/instrumentation-client.ts
// Next.js 16 client-side instrumentation (replaces sentry.client.config.ts
// for Turbopack). Per Sentry docs for Turbopack setup.
import * as Sentry from '@sentry/nextjs';
import { scrubEvent, parseDsn } from '@fleet/observability';

const parsed = parseDsn(process.env['NEXT_PUBLIC_SENTRY_DSN']);
if (parsed.valid && process.env.NODE_ENV !== 'test') {
  const dsn = parsed.dsn;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_SAMPLE_RATE'] ?? '0.1'),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
