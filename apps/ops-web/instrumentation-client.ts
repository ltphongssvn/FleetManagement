// apps/ops-web/instrumentation-client.ts
// Next.js 16 client-side instrumentation. Uses @fleet/observability factory.
import * as Sentry from '@sentry/nextjs';
import { buildSentryOptions } from '@fleet/observability';

const result = buildSentryOptions({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env['NEXT_PUBLIC_SENTRY_SAMPLE_RATE'],
});
if (result.options && process.env.NODE_ENV !== 'test') {
  Sentry.init(result.options as never);
}
