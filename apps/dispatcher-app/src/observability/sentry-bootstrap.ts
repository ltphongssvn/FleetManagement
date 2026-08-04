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
// The split of responsibilities:
//  - decideSentryInit (pure, this package) owns the two decisions
//    @fleet/observability cannot make: never open a client under test, and
//    initialise-but-disable in development.
//  - buildSentryOptions (@fleet/observability) owns DSN parsing and the
//    shared PII posture -- sendDefaultPii false, beforeSend scrubEvent.
//    Neither is restated here.
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
  // buildSentryOptions returns options: null with a skipReason when the DSN
  // fails its own parse. The env boundary already discards a malformed DSN,
  // so this is defence in depth rather than the primary guard.
  if (result.options === null) return;
  Sentry.init({ ...result.options, enabled: decision.enabled } as never);
}
