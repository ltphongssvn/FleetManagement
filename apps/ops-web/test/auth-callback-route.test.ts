// apps/ops-web/test/auth-callback-route.test.ts
// GET /api/auth/callback completes the Authorization Code + PKCE flow. It
// validates state against the request cookie (CSRF), exchanges code +
// code_verifier at the token endpoint (no secret), sets fleet_session httpOnly,
// clears the transient PKCE cookies, and redirects to '/'. On error/mismatch it
// redirects to /login.
//
// Cookie I/O is on the request (reads) and the RESPONSE (writes): the route sets
// fleet_session and deletes the transient cookies on the returned NextResponse so
// the Set-Cookie headers actually reach the browser (vercel/next.js#47126). These
// tests therefore seed cookies on a NextRequest and assert on res.cookies, not on
// a mocked next/headers store.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ENV = {
  OIDC_TOKEN_ENDPOINT: 'https://kc.example.com/realms/fleet/protocol/openid-connect/token',
  OIDC_CLIENT_ID: 'ops-web',
  OIDC_REDIRECT_URI: 'https://ops.example.com/api/auth/callback',
};

function makeReq(
  query: Record<string, string>,
  cookies: Record<string, string> = {},
): NextRequest {
  const url = new URL('https://ops.example.com/api/auth/callback');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new NextRequest(url);
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

function transient(state = 'state-1', verifier = 'verifier-1'): Record<string, string> {
  return { oidc_state: state, oidc_code_verifier: verifier, oidc_nonce: 'nonce-1' };
}

// A deleted cookie is emitted as a Set-Cookie with an empty value + Max-Age=0; in
// the NextResponse cookie jar it reads back as value ''. Treat present-with-''
// as "cleared".
function isCleared(res: { cookies: { get: (n: string) => { value: string } | undefined } }, name: string): boolean {
  const c = res.cookies.get(name);
  return c === undefined || c.value === '';
}

describe('GET /api/auth/callback (Authorization Code + PKCE)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });

  it('exchanges the code (with code_verifier) and sets fleet_session, then redirects home', async () => {
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
    const res = await GET(makeReq({ code: 'auth-code-1', state: 'state-1' }, transient()));

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

    // session set ON THE RESPONSE, transient PKCE cookies cleared ON THE RESPONSE
    const session = res.cookies.get('fleet_session');
    expect(session?.value).toBe('kc-jwt');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('lax');
    expect(session?.path).toBe('/');
    expect(session?.maxAge).toBe(300);
    expect(isCleared(res, 'oidc_code_verifier')).toBe(true);
    expect(isCleared(res, 'oidc_state')).toBe(true);
    expect(isCleared(res, 'oidc_nonce')).toBe(true);

    // redirect home
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://ops.example.com/');
  });

  it('redirects to /login on state mismatch (CSRF) without exchanging', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'c', state: 'state-URL-DIFFERENT' }, transient('state-COOKIE')));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get('fleet_session')).toBeUndefined();
  });

  it('redirects to /login when the provider returns an error param', async () => {
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ error: 'access_denied', state: 'state-1' }, transient()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects to /login when the code_verifier cookie is missing', async () => {
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'c', state: 'state-1' }, { oidc_state: 'state-1' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects to /login when the token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 400 }))));
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'c', state: 'state-1' }, transient()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get('fleet_session')).toBeUndefined();
  });
});
