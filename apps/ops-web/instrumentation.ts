// apps/ops-web/instrumentation.ts
// Next.js App Router instrumentation hook. Loads Sentry server/edge configs
// at the right runtime per Next.js 15/16 conventions.
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    await import('./sentry.server.config.js');
  }
  if (process.env['NEXT_RUNTIME'] === 'edge') {
    await import('./sentry.edge.config.js');
  }
}

export const onRequestError = Sentry.captureRequestError;
