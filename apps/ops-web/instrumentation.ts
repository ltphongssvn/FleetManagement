// apps/ops-web/instrumentation.ts
// Next.js 16 App Router instrumentation hook with inlined Sentry init.
// Inlining (instead of importing sentry.{server,edge}.config.ts) avoids
// Turbopack workspace-package resolution issues in monorepos
// (vercel/next.js#92540, sentry-javascript#8105 Turbopack era).
import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@fleet/observability';

export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
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
  }
  if (process.env['NEXT_RUNTIME'] === 'edge') {
    const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];
    if (dsn && process.env.NODE_ENV !== 'test') {
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV,
        tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_SAMPLE_RATE'] ?? '0.1'),
        sendDefaultPii: false,
        beforeSend: scrubEvent,
      });
    }
  }
  return Promise.resolve();
}

export const onRequestError = Sentry.captureRequestError;
