// apps/owner-app/test/oidc-config.test.ts
// RED: pure OIDC PKCE config builder for the owner app's Keycloak login.
// Given validated env (issuer, client id, scheme), produce the discovery
// URL + authorization-request parameters (RFC 8252 native-app AuthCode+PKCE).
// No native modules - pure and unit-testable.
import { describe, it, expect } from 'vitest';
import {
  OwnerOidcEnvSchema,
  buildOwnerOidcConfig,
  OWNER_OIDC_SCOPES,
} from '../src/auth/oidc-config.js';

const validEnv = {
  EXPO_PUBLIC_OIDC_ISSUER: 'https://keycloak-production-7959.up.railway.app/realms/fleet',
  EXPO_PUBLIC_OIDC_CLIENT_ID: 'owner-app',
  EXPO_PUBLIC_OWNER_APP_SCHEME: 'fleetowner',
};

describe('OwnerOidcEnvSchema', () => {
  it('accepts a valid env', () => {
    expect(OwnerOidcEnvSchema.safeParse(validEnv).success).toBe(true);
  });
  it('rejects a non-URL issuer', () => {
    expect(OwnerOidcEnvSchema.safeParse({ ...validEnv, EXPO_PUBLIC_OIDC_ISSUER: 'not-a-url' }).success).toBe(false);
  });
  it('rejects an empty client id', () => {
    expect(OwnerOidcEnvSchema.safeParse({ ...validEnv, EXPO_PUBLIC_OIDC_CLIENT_ID: '' }).success).toBe(false);
  });
  it('rejects a missing scheme', () => {
    const { EXPO_PUBLIC_OWNER_APP_SCHEME, ...rest } = validEnv;
    void EXPO_PUBLIC_OWNER_APP_SCHEME;
    expect(OwnerOidcEnvSchema.safeParse(rest).success).toBe(false);
  });
});

describe('buildOwnerOidcConfig', () => {
  it('derives the OIDC discovery URL from the issuer', () => {
    const cfg = buildOwnerOidcConfig(validEnv);
    expect(cfg.discoveryUrl).toBe(
      'https://keycloak-production-7959.up.railway.app/realms/fleet/.well-known/openid-configuration',
    );
  });
  it('carries the client id through', () => {
    expect(buildOwnerOidcConfig(validEnv).clientId).toBe('owner-app');
  });
  it('builds a native redirect URI from the app scheme', () => {
    expect(buildOwnerOidcConfig(validEnv).redirectUri).toBe('fleetowner://redirect');
  });
  it('requests openid + profile scopes', () => {
    expect(buildOwnerOidcConfig(validEnv).scopes).toEqual([...OWNER_OIDC_SCOPES]);
    expect(OWNER_OIDC_SCOPES).toContain('openid');
  });
  it('enables PKCE with S256', () => {
    expect(buildOwnerOidcConfig(validEnv).usePKCE).toBe(true);
  });
  it('throws on invalid env rather than returning a partial config', () => {
    expect(() => buildOwnerOidcConfig({ ...validEnv, EXPO_PUBLIC_OIDC_ISSUER: 'bad' })).toThrow();
  });
});
