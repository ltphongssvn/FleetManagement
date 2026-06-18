// apps/ops-web/test/env.test.ts
// TDD: env validation behavior.
import { describe, it, expect } from 'vitest';
import { loadEnv } from '@/env';

describe('@fleet/ops-web - loadEnv', () => {
  it('accepts valid env', () => {
    const e = loadEnv({ NEXT_PUBLIC_APP_VERSION: '1.2.3', NODE_ENV: 'test' });
    expect(e.NEXT_PUBLIC_APP_VERSION).toBe('1.2.3');
  });

  it('defaults version when missing', () => {
    expect(loadEnv({}).NEXT_PUBLIC_APP_VERSION).toBe('0.0.0');
  });

  it('rejects malformed version', () => {
    expect(() => loadEnv({ NEXT_PUBLIC_APP_VERSION: 'abc' })).toThrow(/Invalid env/);
  });
});

describe('@fleet/ops-web - loadEnv (OIDC Authorization Code + PKCE knobs)', () => {
  const oidc = {
    OIDC_AUTHORIZATION_ENDPOINT: 'https://kc.example.com/realms/fleet/protocol/openid-connect/auth',
    OIDC_TOKEN_ENDPOINT: 'https://kc.example.com/realms/fleet/protocol/openid-connect/token',
    OIDC_CLIENT_ID: 'ops-web',
    OIDC_REDIRECT_URI: 'https://ops.example.com/api/auth/callback',
  };

  it('accepts a fully configured OIDC block', () => {
    const e = loadEnv({ ...oidc });
    expect(e.OIDC_AUTHORIZATION_ENDPOINT).toBe(oidc.OIDC_AUTHORIZATION_ENDPOINT);
    expect(e.OIDC_TOKEN_ENDPOINT).toBe(oidc.OIDC_TOKEN_ENDPOINT);
    expect(e.OIDC_CLIENT_ID).toBe('ops-web');
    expect(e.OIDC_REDIRECT_URI).toBe(oidc.OIDC_REDIRECT_URI);
  });

  it('OIDC vars are optional (unset in envs that do not use OIDC login)', () => {
    expect(() => loadEnv({})).not.toThrow();
    expect(loadEnv({}).OIDC_AUTHORIZATION_ENDPOINT).toBeUndefined();
  });

  it('OIDC_DISPATCH_ACR_VALUES is optional and passed through when set', () => {
    expect(loadEnv({ ...oidc }).OIDC_DISPATCH_ACR_VALUES).toBeUndefined();
    expect(loadEnv({ ...oidc, OIDC_DISPATCH_ACR_VALUES: 'aal2' }).OIDC_DISPATCH_ACR_VALUES).toBe('aal2');
  });

  it('rejects a malformed authorization endpoint (must be a URL)', () => {
    expect(() => loadEnv({ ...oidc, OIDC_AUTHORIZATION_ENDPOINT: 'not-a-url' })).toThrow(/Invalid env/);
  });

  it('rejects a malformed redirect URI (must be a URL)', () => {
    expect(() => loadEnv({ ...oidc, OIDC_REDIRECT_URI: 'not-a-url' })).toThrow(/Invalid env/);
  });
});
