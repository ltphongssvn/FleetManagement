// apps/owner-app/src/observability/sentry-bootstrap.ts
// Uses shared @fleet/observability buildSentryOptions; release from package.json.
import * as Sentry from '@sentry/react-native';
import { buildSentryOptions } from '@fleet/observability';
import pkg from '../../package.json' with { type: 'json' };
const version: string = (pkg as { version: string }).version;
function readEnv(name: string): string | undefined {
  const raw: unknown = process.env[name];
  return typeof raw === 'string' ? raw : undefined;
}
export function initSentry(dsn: string | undefined): void {
  if (readEnv('NODE_ENV') === 'test') return;
  const environment = readEnv('NODE_ENV');
  const tracesSampleRate = readEnv('EXPO_PUBLIC_SENTRY_SAMPLE_RATE');
  const result = buildSentryOptions({
    dsn,
    environment,
    tracesSampleRate,
    release: version,
  });
  if (!result.options) return;
  const initOptions = { ...result.options, enabled: environment !== 'development' };
  Sentry.init(initOptions as never);
}
