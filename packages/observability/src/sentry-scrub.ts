// packages/observability/src/sentry-scrub.ts
// Pure PII scrubber shared across api, ops-web, driver-app.
// No Sentry SDK imports — keeps this loadable from RN (no Flow syntax) and
// from any Node/edge runtime. Pure functions, no I/O, no mutation of inputs.

export const PII_HEADERS = new Set<string>([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]) satisfies ReadonlySet<string>;

export const PII_KEY_RE =
  /password|token|secret|authorization|apikey|cookie|push.*token|gps|lat|lng|latitude|longitude|phone|email|ssn|driver.*name/i;

export const PII_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9_.-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
];

export const REDACTED = '[redacted]' as const;
export const UNSCRUBBABLE = '[unscrubbable]' as const;

export function scrubString(s: string): string {
  let out = s;
  for (const re of PII_VALUE_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export interface ScrubberOptions {
  /** Max recursion depth before bailing. Defaults to 6. */
  depthLimit?: number;
}

/**
 * Factory: returns a scrub function bound to the given options.
 * Use when callers need a non-default depth limit.
 */
export function createScrubber(options: ScrubberOptions = {}): (value: unknown, depth?: number) => unknown {
  const depthLimit = options.depthLimit ?? 6;
  const fn = (value: unknown, depth = 0): unknown => {
    if (depth > depthLimit || value === null || value === undefined) return value;
    if (typeof value === 'string') return scrubString(value);
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => fn(v, depth + 1));
    try {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = PII_KEY_RE.test(k) ? REDACTED : fn(v, depth + 1);
      }
      return out;
    } catch {
      return UNSCRUBBABLE;
    }
  };
  return fn;
}

/**
 * Pure: returns a new value, never mutates input.
 * Defensive: catches throws from exotic objects (revoked Proxy, throwing getters).
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  try {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEY_RE.test(k) ? REDACTED : scrub(v, depth + 1);
    }
    return out;
  } catch {
    return UNSCRUBBABLE;
  }
}

export interface ScrubbableEvent {
  request?: {
    headers?: Record<string, string | string[]>;
    data?: unknown;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  message?: string;
  exception?: { values?: { value?: string }[] };
}

function scrubHeaders(
  headers: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of Object.keys(headers)) {
    const v = headers[k];
    if (v === undefined) continue;
    if (PII_HEADERS.has(k.toLowerCase())) {
      out[k] = Array.isArray(v) ? [REDACTED] : REDACTED;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Pure: returns a new event object. Original event is not mutated.
 * Sentry's beforeSend contract permits returning a transformed event.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const next: T = { ...event };

  if (typeof next.message === 'string') {
    next.message = scrubString(next.message);
  }

  if (next.exception?.values) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((ex) =>
        typeof ex.value === 'string' ? { ...ex, value: scrubString(ex.value) } : ex,
      ),
    };
  }

  if (next.request) {
    const req = { ...next.request };
    if (req.headers) req.headers = scrubHeaders(req.headers);
    if (req.data !== undefined) req.data = scrub(req.data);
    next.request = req;
  }

  if (next.extra) next.extra = scrub(next.extra) as Record<string, unknown>;
  if (next.contexts) next.contexts = scrub(next.contexts) as Record<string, unknown>;

  return next;
}
