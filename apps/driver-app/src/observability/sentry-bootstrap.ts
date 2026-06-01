// apps/driver-app/src/observability/sentry-bootstrap.ts
// Uses shared @fleet/observability buildSentryOptions; release from package.json.
import * as Sentry from '@sentry/react-native';
import { buildSentryOptions } from '@fleet/observability';
import pkg from '../../package.json' with { type: 'json' };

const version: string = (pkg as { version: string }).version;

export function initSentry(dsn: string | undefined): void {
  if (process.env.NODE_ENV === 'test') return;
  const result = buildSentryOptions({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env['EXPO_PUBLIC_SENTRY_SAMPLE_RATE'],
    release: version,
  });
  if (!result.options) return;
  const initOptions = { ...result.options, enabled: process.env.NODE_ENV !== 'development' };
  Sentry.init(initOptions as never);
}
