// apps/driver-app/src/observability/sentry-scrub.ts
// Thin re-export from @fleet/observability. All logic + tests live in the
// shared package. Kept free of @sentry/react-native imports so vitest can
// load it without Flow-syntax RN sources.
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
