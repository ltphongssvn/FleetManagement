// apps/driver-app/src/observability/sentry-bootstrap.ts
import * as Sentry from '@sentry/react-native';
import { scrub, scrubString } from './sentry-scrub.js';

type ErrorEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]['beforeSend']>>[0];

function beforeSend(event: ErrorEvent): ErrorEvent {
  const e = event as ErrorEvent & { message?: string; exception?: { values?: { value?: string }[] } };
  if (typeof e.message === 'string') e.message = scrubString(e.message);
  if (e.exception?.values) for (const ex of e.exception.values) if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
  return event;
}

export function initSentry(dsn: string | undefined): void {
  if (!dsn || process.env.NODE_ENV === 'test') return;
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV !== 'development',
    tracesSampleRate: Number(process.env['EXPO_PUBLIC_SENTRY_SAMPLE_RATE'] ?? '0.1'),
    sendDefaultPii: false,
    beforeSend,
  });
}
