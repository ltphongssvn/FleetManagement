// apps/ops-web/src/lib/sentry-scrub.ts
import type * as Sentry from '@sentry/nextjs';

type ErrorEvent = Parameters<NonNullable<Sentry.NodeOptions['beforeSend']>>[0];

const PII_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);
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

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>;
    for (const k of Object.keys(headers)) {
      if (PII_HEADERS.has(k.toLowerCase())) headers[k] = '[redacted]';
    }
  }
  if (event.request?.data !== undefined) {
    const req = event.request;
    req.data = scrub(req.data);
  }
  if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
  return event;
}
