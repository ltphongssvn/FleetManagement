// packages/observability/src/sentry-init.ts
// Sentry init factory. Decouples DSN validation, scrub wiring, and option
// defaults from the host runtime (NestJS, Next.js server/edge/client).
//
// The actual Sentry.init() call lives in the consumer because the SDK
// surface differs per runtime (@sentry/nestjs vs @sentry/nextjs vs
// @sentry/react-native). This factory returns a fully-resolved options
// bundle the consumer passes to its SDK's init().
import { scrubEvent, type ScrubbableEvent } from './sentry-scrub.ts';
import { parseDsn } from './dsn.ts';

export interface SentryInitInput {
  /** Raw DSN from env. parseDsn validates it. */
  dsn: string | undefined;
  /** App environment (development, staging, production). */
  environment?: string | undefined;
  /** Raw trace sample rate string from env (defaults to 0.1). */
  tracesSampleRate?: string | undefined;
  /** Optional release identifier. */
  release?: string | undefined;
}

export interface SentryInitOptions {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  release?: string;
  sendDefaultPii: false;
  beforeSend: (event: ScrubbableEvent) => ScrubbableEvent;
}

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Parse and clamp the trace sample rate.
 * Accepts a stringified number in [0, 1]; falls back to 0.1 for any other
 * input (NaN, negative, > 1, undefined). Defensive against env-var typos.
 */
export function parseTracesSampleRate(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_TRACES_SAMPLE_RATE);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_TRACES_SAMPLE_RATE;
  return n;
}

export interface BuildSentryOptionsResult {
  /** Resolved options to pass to Sentry.init(), or null if init should skip. */
  options: SentryInitOptions | null;
  /** Reason init was skipped (DSN missing, malformed, etc.) — for logging. */
  skipReason?: string;
}

/**
 * Build Sentry init options from raw env input. Returns null options when
 * Sentry should not initialize (no DSN, malformed DSN). Never throws.
 */
export function buildSentryOptions(input: SentryInitInput): BuildSentryOptionsResult {
  const parsed = parseDsn(input.dsn);
  if (!parsed.valid || parsed.dsn === undefined) {
    return { options: null, skipReason: parsed.error ?? 'DSN invalid' };
  }
  const options: SentryInitOptions = {
    dsn: parsed.dsn,
    environment: input.environment ?? 'development',
    tracesSampleRate: parseTracesSampleRate(input.tracesSampleRate),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  };
  if (input.release !== undefined) options.release = input.release;
  return { options };
}
