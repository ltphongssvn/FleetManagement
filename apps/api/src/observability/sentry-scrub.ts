// apps/api/src/observability/sentry-scrub.ts
// Pure PII scrubber. Free of @sentry/nestjs imports for direct testability.
const PII_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);
const PII_KEY_RE = /password|token|secret|authorization|apikey|cookie|push.*token|gps|lat|lng|latitude|longitude|phone|email|ssn|driver.*name/i;

const PII_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9_.-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
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

export interface ScrubbableEvent {
  request?: { headers?: Record<string, string | string[]>; data?: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  message?: string;
  exception?: { values?: { value?: string }[] };
}

export function scrubEvent(event: ScrubbableEvent): ScrubbableEvent {
  if (typeof event.message === 'string') event.message = scrubString(event.message);
  if (event.exception?.values) for (const ex of event.exception.values) if (typeof ex.value === 'string') ex.value = scrubString(ex.value);
  if (event.request?.headers) {
    const h = event.request.headers;
    for (const k of Object.keys(h)) {
      if (PII_HEADERS.has(k.toLowerCase())) {
        h[k] = Array.isArray(h[k]) ? ['[redacted]'] : '[redacted]';
      }
    }
  }
  if (event.request?.data !== undefined) event.request.data = scrub(event.request.data);
  if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrub(event.contexts) as Record<string, unknown>;
  return event;
}
