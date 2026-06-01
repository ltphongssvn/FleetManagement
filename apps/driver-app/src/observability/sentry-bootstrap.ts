// apps/driver-app/src/observability/sentry-bootstrap.ts
// Uses shared @fleet/observability buildSentryOptions; release from package.json.
import * as Sentry from '@sentry/react-native';
import { buildSentryOptions } from '@fleet/observability';
import pkg from '../../package.json' with { type: 'json' };

const version: string = (pkg as { version: string }).version;

export function initSentry(dsn: string | undefined): void {
  if (process.env.NODE_ENV === 'test') return;
  // Bind env reads to explicitly-typed locals first. buildSentryOptions comes
  // from a referenced workspace package (@fleet/observability); when its built
  // dist types are not resolved (clean CI checkout), the inline object degrades
  // to any and trips no-unsafe-assignment. Local typed bindings make the call
  // type-safe regardless of cross-package type resolution.
  const environment: string | undefined = process.env.NODE_ENV;
  const tracesSampleRate: string | undefined = process.env['EXPO_PUBLIC_SENTRY_SAMPLE_RATE'];
  const result = buildSentryOptions({
    dsn,
    environment,
    tracesSampleRate,
    release: version,
  });
  if (!result.options) return;
  const initOptions = { ...result.options, enabled: process.env.NODE_ENV !== 'development' };
  Sentry.init(initOptions as never);
}
