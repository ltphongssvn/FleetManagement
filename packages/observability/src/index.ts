// packages/observability/src/index.ts
export {
  PII_HEADERS,
  PII_KEY_RE,
  PII_VALUE_PATTERNS,
  DEFAULT_DEPTH_LIMIT,
  REDACTED,
  UNSCRUBBABLE,
  scrubString,
  scrub,
  scrubEvent,
  createScrubber,
  type ScrubberOptions,
  type ScrubbableEvent,
} from './sentry-scrub.ts';

export { dsnSchema, parseDsn, type ValidatedDsn, type DsnParseResult } from './dsn.ts';

export {
  buildSentryOptions,
  parseTracesSampleRate,
  type SentryInitInput,
  type SentryInitOptions,
  type BuildSentryOptionsResult,
} from './sentry-init.ts';
