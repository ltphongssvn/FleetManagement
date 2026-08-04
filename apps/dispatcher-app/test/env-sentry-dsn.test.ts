// apps/dispatcher-app/test/env-sentry-dsn.test.ts
// RED (T17 D1d) -- carry the Sentry DSN through the config boundary.
//
// D1c bounds the device-controlled locale query, but the degradation is
// SILENT: a wedged speech engine across a fleet looks exactly like a device
// that legitimately enumerates nothing -- the documented silent-failure
// pattern, where an empty result is treated as valid state and stays
// invisible to every monitoring surface.
//
// The DSN is OPTIONAL, unlike the API URL and the OIDC handles. Those fail
// fast because a deploy without them is broken; a deploy without a DSN is
// merely unobserved. Making Sentry a hard startup requirement would let a
// missing telemetry handle brick voice dispatch for the pilot -- trading a
// reporting gap for an outage.
//
// A MALFORMED DSN is discarded rather than fatal, which is where this departs
// from the common z.url().optional() env recipe. That recipe throws on a bad
// value, so a typo in a telemetry handle would brick the app: the same bad
// trade in a different disguise. The value is still validated when present --
// a broken DSN must not reach the Sentry SDK -- it just degrades to absent.
// buildSentryOptions in @fleet/observability then returns
// { options: null, skipReason }, which is the observable signal.
//
// Assertions use Object.hasOwn, not toBeUndefined. Against a parser that does
// not yet know the field, toBeUndefined passes VACUOUSLY -- the over-permissive
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
const VALID_DSN = 'https://abc123@o1.ingest.sentry.io/42';
describe('parseDispatcherEnv - sentry dsn', () => {
  it('carries a supplied DSN through to the typed env', () => {
    const env = parseDispatcherEnv({ ...BASE, EXPO_PUBLIC_SENTRY_DSN: VALID_DSN });
    expect(Object.hasOwn(env, 'sentryDsn')).toBe(true);
    expect(env.sentryDsn).toBe(VALID_DSN);
  });
  it('OMITS the key entirely when the handle is absent', () => {
    const env = parseDispatcherEnv(BASE);
    expect(Object.hasOwn(env, 'sentryDsn')).toBe(false);
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
  it('still fails fast when a critical handle is missing, naming it', () => {
    const { EXPO_PUBLIC_API_BASE_URL: _omitted, ...withoutApi } = BASE;
    expect(() => parseDispatcherEnv(withoutApi)).toThrow(
      /EXPO_PUBLIC_API_BASE_URL/,
    );
  });
});
