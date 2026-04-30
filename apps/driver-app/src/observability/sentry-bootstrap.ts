// apps/driver-app/src/observability/sentry-bootstrap.ts
import * as Sentry from '@sentry/react-native';
type ErrorEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]['beforeSend']>>[0];

const PII_BODY_KEYS = new Set([
  'password', 'token', 'accessToken', 'refreshToken', 'idToken',
  'authorization', 'apiKey', 'expoPushToken', 'pushToken',
  'gpsLat', 'gpsLng', 'latitude', 'longitude', 'driverPhone', 'driverEmail',
]);

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = PII_BODY_KEYS.has(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function beforeSend(event: ErrorEvent): ErrorEvent {
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
