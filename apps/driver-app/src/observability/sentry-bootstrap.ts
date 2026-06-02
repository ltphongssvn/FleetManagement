// apps/driver-app/src/observability/sentry-bootstrap.ts
// Uses shared @fleet/observability buildSentryOptions; release from package.json.
import * as Sentry from '@sentry/react-native';
import { buildSentryOptions } from '@fleet/observability';
import pkg from '../../package.json' with { type: 'json' };

const version: string = (pkg as { version: string }).version;

// Read an environment variable through an unknown boundary, then narrow with a
// typeof guard. Rationale (CI-only lint parity, typescript-eslint#4435): in a
// pnpm monorepo, projectService does not reliably honor compilerOptions.types,
// so process.env can resolve to any in a clean CI program even when "node" is
// listed -- a direct read then trips no-unsafe-assignment. Assigning any to
// unknown is safe, and typeof narrows unknown to string, so the env reads are
// type-safe regardless of how the program types process.env (local OR CI).
function readEnv(name: string): string | undefined {
  const raw: unknown = process.env[name];
  return typeof raw === 'string' ? raw : undefined;
}

export function initSentry(dsn: string | undefined): void {
  if (readEnv('NODE_ENV') === 'test') return;
  // Bind env reads to typed locals (via the unknown-boundary helper) before the
  // buildSentryOptions call. buildSentryOptions comes from a referenced
  // workspace package (@fleet/observability); when its built dist types are not
  // resolved (clean CI checkout) the inline object can degrade to any. Typed
  // locals make the call type-safe regardless of cross-package type resolution.
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
