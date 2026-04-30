// apps/api/src/observability/sentry-bootstrap.ts
import * as Sentry from '@sentry/nestjs';

interface ScrubbableEvent {
  request?: { headers?: Record<string, string>; data?: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

function parseSampleRate(raw: string | undefined): number {
  const n = Number(raw ?? '0.1');
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.1;
  return n;
}

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

interface ScrubbableEvent2 extends ScrubbableEvent { message?: string; exception?: { values?: { value?: string }[] } }

function beforeSend(event: ScrubbableEvent2): ScrubbableEvent2 {
  if (typeof event.message === 'string') event.message = scrubString(event.message);
  if (event.exception?.values) for (const ex of event.exception.values) if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  if (event.request?.headers) {
    for (const k of Object.keys(event.request.headers)) {
      if (PII_HEADERS.has(k.toLowerCase())) event.request.headers[k] = '[redacted]';
    }
  }
  if (event.request?.data !== undefined) {
    event.request.data = scrub(event.request.data);
  }
  if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrub(event.contexts) as Record<string, unknown>;
  return event;
}

export function initSentry(): void {
  if (process.env['NODE_ENV'] === 'test') return;
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: parseSampleRate(process.env['SENTRY_TRACES_SAMPLE_RATE']),
    release: process.env['npm_package_version'],
    sendDefaultPii: false,
    beforeSend: beforeSend as never,
  });
}
