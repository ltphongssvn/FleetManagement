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
  type ScrubbableEvent,
} from './sentry-scrub.js';
