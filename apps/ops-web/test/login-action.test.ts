// apps/ops-web/test/login-action.test.ts
// RED: the login server action no longer does ROPC. It builds an Authorization
// Code + PKCE request, persists code_verifier/state/nonce in httpOnly cookies,
// and redirects the browser to Keycloak's authorization endpoint. No password is
// collected or sent. acr_values is included when OIDC_DISPATCH_ACR_VALUES is set.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet, get: vi.fn(), delete: vi.fn() }),
}));
const redirect = vi.fn((_url: string) => {
  throw new Error('NEXT_REDIRECT');
});
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('server-only', () => ({}));

const ENV = {
  OIDC_AUTHORIZATION_ENDPOINT: 'https://kc.example.com/realms/fleet/protocol/openid-connect/auth',
  OIDC_CLIENT_ID: 'ops-web',
  OIDC_REDIRECT_URI: 'https://ops.example.com/api/auth/callback',
};

function stubEnv(extra: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries({ ...ENV, ...extra })) vi.stubEnv(k, v);
}

describe('login server action (Authorization Code + PKCE)', () => {
  beforeEach(() => {
    cookieSet.mockClear();
    redirect.mockClear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('redirects to the Keycloak authorize endpoint with a PKCE S256 challenge', async () => {
    stubEnv();
    const { startLogin } = await import('@/features/auth/login.action');
    await expect(startLogin()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirect).toHaveBeenCalledTimes(1);
    const target = redirect.mock.calls[0]?.[0] ?? '';
    const url = new URL(target);
    expect(url.origin + url.pathname).toBe(ENV.OIDC_AUTHORIZATION_ENDPOINT);
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('ops-web');
    expect(p.get('redirect_uri')).toBe(ENV.OIDC_REDIRECT_URI);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBeTruthy();
    expect(p.get('state')).toBeTruthy();
    expect(p.get('nonce')).toBeTruthy();
  });

  it('persists code_verifier, state and nonce in httpOnly cookies', async () => {
    stubEnv();
    const { startLogin } = await import('@/features/auth/login.action');
    await expect(startLogin()).rejects.toThrow('NEXT_REDIRECT');

    const names = cookieSet.mock.calls.map((c) => c[0] as string);
    expect(names).toContain('oidc_code_verifier');
    expect(names).toContain('oidc_state');
    expect(names).toContain('oidc_nonce');
    for (const call of cookieSet.mock.calls) {
      expect(call[2]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    }
  });

  it('cookie state matches the state sent on the authorize URL (CSRF binding)', async () => {
    stubEnv();
    const { startLogin } = await import('@/features/auth/login.action');
    await expect(startLogin()).rejects.toThrow('NEXT_REDIRECT');

    const urlState = new URL(redirect.mock.calls[0]?.[0] ?? '').searchParams.get('state');
    const stateCookie = cookieSet.mock.calls.find((c) => c[0] === 'oidc_state');
    expect(stateCookie?.[1]).toBe(urlState);
  });

  it('includes acr_values when OIDC_DISPATCH_ACR_VALUES is set', async () => {
    stubEnv({ OIDC_DISPATCH_ACR_VALUES: 'aal2' });
    const { startLogin } = await import('@/features/auth/login.action');
    await expect(startLogin()).rejects.toThrow('NEXT_REDIRECT');
    expect(new URL(redirect.mock.calls[0]?.[0] ?? '').searchParams.get('acr_values')).toBe('aal2');
  });

  it('returns server_error (no redirect) when OIDC is not configured', async () => {
    const { startLogin } = await import('@/features/auth/login.action');
    const r = await startLogin();
    expect(r).toEqual({ status: 'server_error', message: expect.stringContaining('OIDC') });
    expect(redirect).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
