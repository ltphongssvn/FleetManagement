// apps/driver-app/src/observability/sentry-bootstrap.ts
import * as Sentry from '@sentry/react-native';

export function initSentry(dsn: string | undefined): void {
  if (!dsn || process.env.NODE_ENV === 'test') return;
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV !== 'development',
    tracesSampleRate: Number(process.env['EXPO_PUBLIC_SENTRY_SAMPLE_RATE'] ?? '0.1'),
  });
}
