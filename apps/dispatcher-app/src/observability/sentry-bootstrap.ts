// apps/dispatcher-app/src/observability/sentry-bootstrap.ts
// Starts the Sentry client (T17 D1d), so the D1c locale-query timeout reaches
// a monitoring surface instead of degrading invisibly.
//
// NOT coverage-excluded, unlike driver-app's equivalent. vi.mock with a
// factory substitutes @sentry/react-native before it is evaluated, so the
// real package never drags expo-modules-core into the node lane and this
// module executes under test like any other. That is the same premise D1b
// disproved for the STT adapter: "native modules cannot be tested" is
// inherited, not true. A source-text guard could only assert that Sentry.init
// appears once; it could never prove init is SKIPPED under NODE_ENV=test,
// which is the invariant that matters.
//
// The split of responsibilities, with nothing restated:
//  - decideSentryInit (pure, this package) owns the two decisions
//    @fleet/observability cannot make: never open a client under test, and
//    initialise-but-disable in development.
//  - buildSentryOptions (@fleet/observability) owns DSN parsing and the
//    shared PII posture -- sendDefaultPii false, beforeSend scrubEvent.
import * as Sentry from '@sentry/react-native';
import { buildSentryOptions } from '@fleet/observability';
import pkg from '../../package.json' with { type: 'json' };
import { decideSentryInit, type SentryDecisionInput } from './sentry-decision.js';
const version: string = (pkg as { version: string }).version;
/** Start Sentry if the pure decision says so. Returns nothing: callers must
 *  not branch on the outcome, because every skip is already deliberate. */
export function initSentry(input: SentryDecisionInput): void {
  const decision = decideSentryInit(input);
  if (!decision.shouldInit) return;
  const result = buildSentryOptions({
    dsn: decision.dsn,
    environment: input.nodeEnv,
    release: version,
  });
  // UNREACHABLE, and deliberately so. buildSentryOptions returns options:null
  // only when parseDsn rejects, and the config boundary now validates with the
  // SAME dsnSchema that parseDsn uses, so anything arriving here has already
  // passed it. The guard stays because the return type admits null and tsc is
  // right to demand it; ignoring it for coverage follows the precedent in
  // packages/observability/src/dsn.ts, which marks its own provably-dead
  // branch the same way. Writing a test for it would mean fabricating a value
  // the boundary cannot emit.
  /* c8 ignore next */
  if (result.options === null) return;
  Sentry.init({ ...result.options, enabled: decision.enabled } as never);
}
