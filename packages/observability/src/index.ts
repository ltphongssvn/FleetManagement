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
  setScrubErrorHandler,
  createScrubber,
  type ScrubberOptions,
  type ScrubbableEvent,
  type PiiHeaderName,
  isPiiHeader,
  assertPiiHeader,
} from './sentry-scrub.ts';

export { dsnSchema, parseDsn, type ValidatedDsn, type DsnParseResult } from './dsn.ts';

export {
  scrubberConfigSchema,
  validateScrubberConfig,
  type ScrubberConfig,
} from './scrubber-config.ts';

export {
  buildSentryOptions,
  parseTracesSampleRate,
  type SentryInitInput,
  type SentryInitOptions,
  type BuildSentryOptionsResult,
  createBeforeSend,
  type CreateBeforeSendOptions,
} from './sentry-init.ts';
