// packages/observability/src/index.ts
export {
  PII_HEADERS,
  PII_HEADERS_LITERALS,
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
} from './sentry-scrub.js';

export { dsnSchema, parseDsn, type ValidatedDsn, type DsnParseResult } from './dsn.js';

export {
  scrubberConfigSchema,
  validateScrubberConfig,
  type ScrubberConfig,
} from './scrubber-config.js';

export {
  buildSentryOptions,
  parseTracesSampleRate,
  type SentryInitInput,
  type SentryInitOptions,
  type BuildSentryOptionsResult,
  createBeforeSend,
  readDepthLimitFromEnv,
  type CreateBeforeSendOptions,
} from './sentry-init.js';
