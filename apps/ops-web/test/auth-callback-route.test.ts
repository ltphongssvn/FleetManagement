// apps/ops-web/test/auth-callback-route.test.ts
// RED: GET /api/auth/callback completes the Authorization Code + PKCE flow. It
// validates state against the cookie (CSRF), exchanges code + code_verifier at the
// token endpoint (no secret), sets fleet_session httpOnly, clears the transient
// PKCE cookies, and redirects to '/'. On error/mismatch it redirects to /login.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string) => { store.set(name, value); });
const cookieDelete = vi.fn((name: string) => { store.delete(name); });
const cookieGet = vi.fn((name: string) => {
  const value = store.get(name);
  return value === undefined ? undefined : { name, value };
});
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGet, set: cookieSet, delete: cookieDelete }),
}));

const ENV = {
  OIDC_TOKEN_ENDPOINT: 'https://kc.example.com/realms/fleet/protocol/openid-connect/token',
  OIDC_CLIENT_ID: 'ops-web',
  OIDC_REDIRECT_URI: 'https://ops.example.com/api/auth/callback',
};

function makeReq(query: Record<string, string>): Request {
  const url = new URL('https://ops.example.com/api/auth/callback');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url);
}

function seedTransient(state = 'state-1', verifier = 'verifier-1'): void {
  store.set('oidc_state', state);
  store.set('oidc_code_verifier', verifier);
  store.set('oidc_nonce', 'nonce-1');
}

describe('GET /api/auth/callback (Authorization Code + PKCE)', () => {
  beforeEach(() => {
    store.clear();
    cookieSet.mockClear(); cookieDelete.mockClear(); cookieGet.mockClear();
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });

  it('exchanges the code (with code_verifier) and sets fleet_session, then redirects home', async () => {
    seedTransient();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: 'kc-jwt', expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'auth-code-1', state: 'state-1' }));

    // token request shape
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(ENV.OIDC_TOKEN_ENDPOINT);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-1');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('client_id')).toBe('ops-web');
    expect(body.get('redirect_uri')).toBe(ENV.OIDC_REDIRECT_URI);

    // session set, transient PKCE cookies cleared
    expect(cookieSet).toHaveBeenCalledWith('fleet_session', 'kc-jwt', expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 300 }));
    expect(cookieDelete).toHaveBeenCalledWith('oidc_code_verifier');
    expect(cookieDelete).toHaveBeenCalledWith('oidc_state');
    expect(cookieDelete).toHaveBeenCalledWith('oidc_nonce');

    // redirect home
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://ops.example.com/');
  });

  it('redirects to /login on state mismatch (CSRF) without exchanging', async () => {
    seedTransient('state-COOKIE', 'verifier-1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'c', state: 'state-URL-DIFFERENT' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(cookieSet).not.toHaveBeenCalledWith('fleet_session', expect.anything(), expect.anything());
  });

  it('redirects to /login when the provider returns an error param', async () => {
    seedTransient();
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ error: 'access_denied', state: 'state-1' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects to /login when the code_verifier cookie is missing', async () => {
    store.set('oidc_state', 'state-1');
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'c', state: 'state-1' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects to /login when the token exchange fails', async () => {
    seedTransient();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 400 }))));
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'c', state: 'state-1' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(cookieSet).not.toHaveBeenCalledWith('fleet_session', expect.anything(), expect.anything());
  });
});
