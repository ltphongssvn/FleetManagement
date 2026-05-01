// packages/observability/src/index.ts
export {
  PII_HEADERS,
  PII_KEY_RE,
  PII_VALUE_PATTERNS,
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
