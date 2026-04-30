// apps/ops-web/src/lib/sentry-scrub.ts
import type * as Sentry from '@sentry/nextjs';

type ErrorEvent = Parameters<NonNullable<Sentry.NodeOptions['beforeSend']>>[0];

const PII_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);
const PII_KEY_RE = /password|token|secret|authorization|apikey|cookie|push.*token|gps|lat|lng|latitude|longitude|phone|email|ssn|driver.*name/i;

const PII_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9_.-]+/gi, // bearer token (must run before JWT to capture prefix)
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // email
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, // phone
];

export function scrubString(s: string): string {
  let out = s;
  for (const re of PII_VALUE_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}


export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = PII_KEY_RE.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const e = event as ErrorEvent & { message?: string; exception?: { values?: { value?: string }[] } };
  if (typeof e.message === 'string') e.message = scrubString(e.message);
  if (e.exception?.values) for (const ex of e.exception.values) if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  if (event.request?.headers) {
    const h = event.request.headers as Record<string, string | string[]>;
    for (const k of Object.keys(h)) {
      if (PII_HEADERS.has(k.toLowerCase())) {
        h[k] = Array.isArray(h[k]) ? ['[redacted]'] : '[redacted]';
      }
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
