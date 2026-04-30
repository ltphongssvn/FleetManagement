// apps/ops-web/src/lib/sentry-scrub.ts
// Thin re-export from @fleet/observability. All logic + tests live in the
// shared package.
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
