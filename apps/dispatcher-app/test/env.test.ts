// apps/dispatcher-app/test/env.test.ts
// RED-first spec for the dispatcher-app config boundary (T17 V10b,
// Twelve-Factor III). Deploy-varying values (API base URL, Keycloak
// issuer/client) are validated ONCE at the boundary by Zod; business
// code never reads process.env. Critical handles FAIL FAST -- a typed
// throw at startup beats a silent fallback hiding a deploy error.
// Written before src/config/env.ts exists.
import { describe, expect, it } from 'vitest';
import { parseDispatcherEnv } from '../src/config/env.js';
const VALID = {
  EXPO_PUBLIC_API_BASE_URL: 'https://api.fleet.test',
  EXPO_PUBLIC_OIDC_ISSUER: 'https://idp.fleet.test/realms/fleet',
  EXPO_PUBLIC_OIDC_CLIENT_ID: 'dispatcher-app',
};
describe('@fleet/dispatcher-app env boundary', () => {
  it('parses a valid environment and strips the URL trailing slash', () => {
    const env = parseDispatcherEnv({
      ...VALID,
      EXPO_PUBLIC_API_BASE_URL: 'https://api.fleet.test/',
    });
    expect(env.apiBaseUrl).toBe('https://api.fleet.test');
    expect(env.oidcIssuer).toBe('https://idp.fleet.test/realms/fleet');
    expect(env.oidcClientId).toBe('dispatcher-app');
  });
  it('fails fast when the API base URL is missing', () => {
    const bad: Record<string, string | undefined> = { ...VALID };
    delete bad['EXPO_PUBLIC_API_BASE_URL'];
    expect(() => parseDispatcherEnv(bad)).toThrow();
  });
  it('rejects a non-URL base and a non-https issuer', () => {
    expect(() => parseDispatcherEnv({ ...VALID, EXPO_PUBLIC_API_BASE_URL: 'not a url' })).toThrow();
    expect(() => parseDispatcherEnv({ ...VALID, EXPO_PUBLIC_OIDC_ISSUER: 'http://insecure' })).toThrow();
  });
  it('ignores unknown EXPO_PUBLIC keys (loose consumer envelope)', () => {
    const env = parseDispatcherEnv({ ...VALID, EXPO_PUBLIC_FUTURE: 'x' });
    expect(env.apiBaseUrl).toBe('https://api.fleet.test');
  });
});
