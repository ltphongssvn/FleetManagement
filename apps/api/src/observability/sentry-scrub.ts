// apps/api/src/observability/sentry-scrub.ts
// Thin re-export from @fleet/observability. Kept for import-path stability;
// all logic lives in the shared package and is tested there.
export {
  scrub,
  scrubString,
  scrubEvent,
  PII_HEADERS,
  PII_KEY_RE,
  PII_VALUE_PATTERNS,
  REDACTED,
  UNSCRUBBABLE,
  type ScrubbableEvent,
} from '@fleet/observability';
