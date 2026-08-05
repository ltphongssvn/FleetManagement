// apps/dispatcher-app/test/env-sentry-dsn.test.ts
// The Sentry DSN at the config boundary (T17 D1d).
//
// D1c bounds the device-controlled locale query, but the degradation is
// SILENT: a wedged speech engine across a fleet looks exactly like a device
// that legitimately enumerates nothing -- an empty result treated as valid
// state, invisible to every monitoring surface.
//
// The DSN is OPTIONAL, unlike the API URL and the OIDC handles. Those fail
// fast because a deploy without them is broken; a deploy without a DSN is
// merely unobserved. Making Sentry a hard startup requirement would let a
// missing telemetry handle brick voice dispatch for the pilot -- trading a
// reporting gap for an outage. A MALFORMED DSN is discarded for the same
// reason: a typo must not fail the boot.
//
// Validation uses dsnSchema from @fleet/observability, NOT a local z.url().
// The first version validated with z.url() here while the package validated
// with DSN_REGEX (https://<hex>@<host>/<digits>) downstream. Two validators
// for one value is a gap by construction: https://api.example.com clears the
// first and fails the second, so a value the boundary called good reached
// buildSentryOptions and was rejected there. Defining the shape once and
// validating at the edge closes it -- and makes the package's own null-options
// path unreachable rather than merely untested.
//
// Assertions use Object.hasOwn, not toBeUndefined. Against a parser that does
// not know the field, toBeUndefined passes VACUOUSLY -- the over-permissive
// matcher that makes a test contribute coverage while verifying nothing.
// hasOwn distinguishes key-omitted from key-present-and-undefined, which is
// also the exactOptionalPropertyTypes distinction the parser must honour.
import { describe, expect, it } from 'vitest';
import { parseDispatcherEnv } from '../src/config/env.js';
const BASE = {
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com',
  EXPO_PUBLIC_OIDC_ISSUER: 'https://id.example.com/realms/fleet',
  EXPO_PUBLIC_OIDC_CLIENT_ID: 'dispatcher-app',
} satisfies Record<string, string>;
const VALID_DSN = 'https://abc123@o0.ingest.sentry.io/42';
describe('parseDispatcherEnv - sentry dsn', () => {
  it('carries a supplied DSN through to the typed env', () => {
    const env = parseDispatcherEnv({ ...BASE, EXPO_PUBLIC_SENTRY_DSN: VALID_DSN });
    expect(Object.hasOwn(env, 'sentryDsn')).toBe(true);
    expect(env.sentryDsn).toBe(VALID_DSN);
  });
  it('OMITS the key entirely when the handle is absent', () => {
    expect(Object.hasOwn(parseDispatcherEnv(BASE), 'sentryDsn')).toBe(false);
  });
  it('does NOT fail startup when the DSN is missing', () => {
    const env = parseDispatcherEnv(BASE);
    expect(env.apiBaseUrl).toBe('https://api.example.com');
    expect(env.oidcClientId).toBe('dispatcher-app');
  });
  it('discards a MALFORMED DSN instead of bricking startup', () => {
    const env = parseDispatcherEnv({
      ...BASE,
      EXPO_PUBLIC_SENTRY_DSN: 'not-a-url',
    });
    expect(Object.hasOwn(env, 'sentryDsn')).toBe(false);
    expect(env.apiBaseUrl).toBe('https://api.example.com');
  });
  it('rejects a plain https URL that is not a Sentry DSN shape', () => {
    const env = parseDispatcherEnv({
      ...BASE,
      EXPO_PUBLIC_SENTRY_DSN: 'https://api.example.com',
    });
    expect(Object.hasOwn(env, 'sentryDsn')).toBe(false);
  });
  it('rejects a DSN with no project id', () => {
    const env = parseDispatcherEnv({
      ...BASE,
      EXPO_PUBLIC_SENTRY_DSN: 'https://abc123@o0.ingest.sentry.io',
    });
    expect(Object.hasOwn(env, 'sentryDsn')).toBe(false);
  });
  it('still fails fast when a critical handle is missing, naming it', () => {
    const { EXPO_PUBLIC_API_BASE_URL: _omitted, ...withoutApi } = BASE;
    expect(() => parseDispatcherEnv(withoutApi)).toThrow(
      /EXPO_PUBLIC_API_BASE_URL/,
    );
  });
});
