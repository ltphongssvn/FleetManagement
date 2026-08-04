// apps/dispatcher-app/src/observability/sentry-decision.ts
// Pure decision: should Sentry initialise, and should it report (T17 D1d)?
//
// Only the Sentry.init call itself is impure, so only that call lives in the
// coverage-excluded bootstrap. driver-app's sentry-bootstrap.ts mixes the
// decision with the effect and is excluded whole, which means nothing proves
// its skip logic. This is the same split that let the STT port reach full
// coverage in D1b: keep the excluded surface to a single call.
//
// DSN validation is NOT re-implemented here. buildSentryOptions in
// @fleet/observability already parses the DSN and returns
// { options: null, skipReason } when it is absent or malformed, and the env
// boundary already discards a malformed value. This adds only the two
// decisions neither of those can make.
/** Why the client did not start. Literal codes rather than free text, so
 *  skips are groupable in a dashboard and a spec cannot assert something as
 *  weak as typeof === 'string'. */
export type SentrySkipReason = 'test-environment' | 'no-dsn';
/** Discriminated union: enabled is meaningful only when the client starts,
 *  skipReason only when it does not. As optional fields on one object every
 *  invalid combination would be representable, and the bootstrap branches on
 *  exactly this distinction. */
export type SentryDecision =
  | { shouldInit: true; enabled: boolean; dsn: string }
  | { shouldInit: false; skipReason: SentrySkipReason };
export interface SentryDecisionInput {
  dsn?: string;
  nodeEnv?: string;
}
export function decideSentryInit(input: SentryDecisionInput): SentryDecision {
  // Checked FIRST, before the DSN: under test a client must never open, even
  // if a DSN happens to be present. A leaked client keeps handles alive after
  // the suite passes -- the class D1c avoided by injecting the timer instead
  // of using fake timers.
  if (input.nodeEnv === 'test') {
    return { shouldInit: false, skipReason: 'test-environment' };
  }
  if (input.dsn === undefined) {
    return { shouldInit: false, skipReason: 'no-dsn' };
  }
  // An absent NODE_ENV is treated as development, which is the fail-closed
  // outcome for a telemetry decision: an unknown environment does not report.
  // Bricking the boot over a missing env var would be the trade the DSN
  // handling already refuses. Matches driver-app's
  // enabled: environment !== 'development'.
  return {
    shouldInit: true,
    enabled: input.nodeEnv === 'production',
    dsn: input.dsn,
  };
}
