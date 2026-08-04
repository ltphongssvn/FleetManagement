// apps/dispatcher-app/test/sentry-decision.test.ts
// RED (T17 D1d) -- decide whether Sentry should initialise.
//
// The DECISION is pure and belongs here; only the Sentry.init call itself is
// impure. driver-app's sentry-bootstrap.ts mixes both and is therefore
// coverage-excluded, which means nothing proves its skip logic. Splitting the
// decision out keeps the excluded surface to a single call -- the same split
// that let the STT port reach full coverage in D1b.
//
// buildSentryOptions in @fleet/observability already returns
// { options: null, skipReason } for an absent or malformed DSN, so this does
// not re-implement DSN validation. It adds the two decisions that package
// cannot make:
//  - NODE_ENV=test must never initialise. Otherwise every unit run opens a
//    Sentry client, and a leaked client keeps handles alive after the suite
//    passes -- the same class as the fake timers avoided in D1c.
//  - development must not ENABLE reporting even with a DSN present, so a
//    developer's laptop does not pollute the pilot's issue stream.
//    driver-app encodes this as enabled: environment !== 'development'.
//
// The result is a DISCRIMINATED UNION. enabled is meaningful only when the
// client initialises, and skipReason only when it does not; as optional
// fields on one object every invalid combination is representable, and the
// bootstrap branches on exactly this distinction. skipReason is a literal
// union rather than string, so skips are groupable in a dashboard and so the
// spec cannot assert something as weak as typeof === 'string'.
//
// An absent NODE_ENV is treated as development. That IS the fail-closed
// outcome for a telemetry decision -- unknown environment means do not
// report. Halting the boot instead would brick voice dispatch over a missing
// env var, the same trade the DSN handling already refuses.
import { describe, expect, it } from 'vitest';
import { decideSentryInit } from '../src/observability/sentry-decision.js';
const DSN = 'https://0000000000000000000000000000000@o0.ingest.sentry.io/0';
describe('decideSentryInit', () => {
  it('initialises and enables in production with a DSN', () => {
    expect(decideSentryInit({ dsn: DSN, nodeEnv: 'production' })).toStrictEqual({
      shouldInit: true,
      enabled: true,
      dsn: DSN,
    });
  });
  it('never initialises under NODE_ENV=test, even with a DSN', () => {
    expect(decideSentryInit({ dsn: DSN, nodeEnv: 'test' })).toStrictEqual({
      shouldInit: false,
      skipReason: 'test-environment',
    });
  });
  it('does not initialise without a DSN, naming the reason', () => {
    expect(decideSentryInit({ nodeEnv: 'production' })).toStrictEqual({
      shouldInit: false,
      skipReason: 'no-dsn',
    });
  });
  it('initialises but stays DISABLED in development', () => {
    expect(decideSentryInit({ dsn: DSN, nodeEnv: 'development' })).toStrictEqual({
      shouldInit: true,
      enabled: false,
      dsn: DSN,
    });
  });
  it('treats an absent NODE_ENV as development, not production', () => {
    expect(decideSentryInit({ dsn: DSN })).toStrictEqual({
      shouldInit: true,
      enabled: false,
      dsn: DSN,
    });
  });
  it('prefers the test skip over the missing-DSN skip', () => {
    expect(decideSentryInit({ nodeEnv: 'test' })).toStrictEqual({
      shouldInit: false,
      skipReason: 'test-environment',
    });
  });
});
