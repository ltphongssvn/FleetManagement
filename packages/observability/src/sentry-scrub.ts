// packages/observability/src/sentry-scrub.ts
// Pure PII scrubber shared across api, ops-web, driver-app.
// No Sentry SDK imports — keeps this loadable from RN (no Flow syntax) and
// from any Node/edge runtime. Pure functions, no I/O, no mutation of inputs.

/**
 * Canonical list of PII header names as a readonly literal tuple.
 * The Set below is derived from this for O(1) lookup; the tuple preserves
 * literal types for callers that need exhaustive checks.
 */
export const PII_HEADERS_LITERALS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
] as const satisfies readonly string[];

export const PII_HEADERS: ReadonlySet<string> = new Set<string>(PII_HEADERS_LITERALS);

declare const _piiHeaderBrand: unique symbol;
/**
 * Branded string type: only values that have passed isPiiHeader/assertPiiHeader
 * carry this type. Lets APIs require a vetted PII header name in their signature.
 */
export type PiiHeaderName = string & { readonly [_piiHeaderBrand]: 'PiiHeaderName' };

/** Type guard: true if the input is a known PII header (case-insensitive). */
export function isPiiHeader(name: string): name is PiiHeaderName {
  return PII_HEADERS.has(name.toLowerCase());
}

/** Asserts the input is a known PII header; throws otherwise. Returns branded value. */
export function assertPiiHeader(name: string): PiiHeaderName {
  if (!isPiiHeader(name)) throw new Error(`Not a known PII header: ${name}`);
  return name;
}

export const PII_KEY_RE =
  /password|token|secret|authorization|apikey|cookie|push.*token|gps|lat|lng|latitude|longitude|phone|email|ssn|driver.*name/i;

export const PII_VALUE_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9_.-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  // bcrypt hashes (2026-07-06 Sentry leak: driver password_hash appeared
  // verbatim in a drizzle Failed-query alert).
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g,
  // drizzle QueryPromise failure messages append the ENTIRE bound-params
  // list (names, phones, hashes, tenant ids) after a params: line. The
  // SQL shape above the line is diagnostic; the values are pure PII --
  // redact everything from params: to end of string.
  /params:[\s\S]*$/g,
];

/**
 * Default maximum recursion depth when scrubbing nested structures.
 * Chosen empirically: covers typical Sentry event shape (event → request →
 * data → nested form fields, ~4-5 levels) with one level of headroom.
 * Above 6, recursion is more likely to indicate a cycle or pathological
 * input than legitimate data, so we bail with the original value.
 */
export const DEFAULT_DEPTH_LIMIT = 6;

export const REDACTED = '[redacted]' as const;
export const UNSCRUBBABLE = '[unscrubbable]' as const;

/**
 * Redact PII patterns (Bearer tokens, JWTs, emails, phone numbers) from a
 * string. Returns the input unchanged if no patterns match. Pure.
 */
export function scrubString(s: string): string {
  let out = s;
  for (const re of PII_VALUE_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export interface ScrubberOptions {
  /** Max recursion depth before bailing. Defaults to DEFAULT_DEPTH_LIMIT (6). */
  depthLimit?: number;
  /**
   * Called when scrub catches a throw (e.g. revoked Proxy, throwing getter).
   * Hook for emitting metrics/breadcrumbs without coupling this package to
   * a specific observability vendor. The scrubber still returns UNSCRUBBABLE.
   */
  onScrubError?: (err: unknown) => void;
  /** Override the PII key regex. Defaults to PII_KEY_RE. */
  piiKeyPattern?: RegExp;
  /** Override PII value patterns. Defaults to PII_VALUE_PATTERNS. */
  piiValuePatterns?: readonly RegExp[];
  /**
   * Called once per redaction event (key-match or value-pattern hit).
   * Hook for audit/metrics: count how often PII was found per request.
   */
  onRedact?: (info: { kind: 'key' | 'value'; key?: string; pattern?: RegExp }) => void;
}

/**
 * Factory: returns a scrub function bound to the given options.
 * Use when callers need a non-default depth limit.
 */
export function createScrubber(
  options: ScrubberOptions = {},
): (value: unknown, depth?: number) => unknown {
  const depthLimit = options.depthLimit ?? DEFAULT_DEPTH_LIMIT;
  const keyPattern = options.piiKeyPattern ?? PII_KEY_RE;
  const valuePatterns = options.piiValuePatterns ?? PII_VALUE_PATTERNS;
  const onRedact = options.onRedact;
  const scrubStringWithPatterns = (str: string): string => {
    let out = str;
    for (const re of valuePatterns) {
      const before = out;
      out = out.replace(re, REDACTED);
      if (onRedact && before !== out) onRedact({ kind: 'value', pattern: re });
    }
    return out;
  };
  const fn = (value: unknown, depth = 0): unknown => {
    if (depth > depthLimit || value === null || value === undefined) return value;
    if (typeof value === 'string') return scrubStringWithPatterns(value);
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => fn(v, depth + 1));
    try {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (keyPattern.test(k)) {
          out[k] = REDACTED;
          onRedact?.({ kind: 'key', key: k });
        } else {
          out[k] = fn(v, depth + 1);
        }
      }
      return out;
    } catch (err) {
      options.onScrubError?.(err);
      return UNSCRUBBABLE;
    }
  };
  return fn;
}

/**
 * Module-level error handler invoked by the default scrub() when it catches
 * a throw. Set via setScrubErrorHandler. Apps wire this to Sentry/metrics.
 */
let moduleScrubErrorHandler: ((err: unknown) => void) | undefined;

/**
 * Register (or clear, with undefined) a global error handler for the default
 * scrub() function. Process-level: callers using createScrubber should pass
 * onScrubError per-instance instead.
 */
export function setScrubErrorHandler(handler: ((err: unknown) => void) | undefined): void {
  moduleScrubErrorHandler = handler;
}

/**
 * Pure: returns a new value, never mutates input.
 * Defensive: catches throws from exotic objects (revoked Proxy, throwing getters).
 * Errors caught here flow through the handler set by setScrubErrorHandler.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > DEFAULT_DEPTH_LIMIT || value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  try {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEY_RE.test(k) ? REDACTED : scrub(v, depth + 1);
    }
    return out;
  } catch (err) {
    moduleScrubErrorHandler?.(err);
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
