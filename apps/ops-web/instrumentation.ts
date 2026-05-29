// apps/ops-web/instrumentation.ts
// Next.js 16 App Router instrumentation hook. Sentry options are built by
// @fleet/observability so init logic stays single-sourced.
import * as Sentry from '@sentry/nextjs';
import { buildSentryOptions } from '@fleet/observability';

export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const result = buildSentryOptions({
      dsn: process.env['SENTRY_DSN'],
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env['SENTRY_TRACES_SAMPLE_RATE'],
    });
    if (result.options && process.env.NODE_ENV !== 'test') {
      Sentry.init(result.options as never);
    }
  }
  if (process.env['NEXT_RUNTIME'] === 'edge') {
    const result = buildSentryOptions({
      dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
      environment: process.env.NODE_ENV,
      tracesSampleRate: process.env['NEXT_PUBLIC_SENTRY_SAMPLE_RATE'],
    });
    if (result.options && process.env.NODE_ENV !== 'test') {
      Sentry.init(result.options as never);
    }
  }
  return Promise.resolve();
}

export const onRequestError = Sentry.captureRequestError;
