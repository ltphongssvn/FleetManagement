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

function makeReq(query: Record<string, string>, cookies: Record<string, string> = {}): NextRequest {
  const url = new URL('https://ops.example.com/api/auth/callback');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new NextRequest(url);
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

function transient(state = 'state-1', verifier = 'verifier-1'): Record<string, string> {
  return { oidc_state: state, oidc_code_verifier: verifier, oidc_nonce: 'nonce-1' };
}

// Mint a realistic JWT access token carrying the claims the callback now
// ENFORCES (acr + idp). Signature is irrelevant (ops-web decodes, does not
// verify; JWKS verification is the API's job). A valid dispatcher token is
// brokered via Google and reached aal3 (WebAuthn passkey).
function makeAccessJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ exp: 9999999999, aud: 'fleet-pilot', ...claims });
  return `${header}.${body}.sig`;
}
// The canonical "good" token: Google-brokered, aal3 passkey.
const VALID_JWT = makeAccessJwt({ acr: 'aal3', idp: 'google' });

// A deleted cookie is emitted as a Set-Cookie with an empty value + Max-Age=0; in
// the NextResponse cookie jar it reads back as value ''. Treat present-with-''
// as "cleared".
function isCleared(
  res: { cookies: { get: (n: string) => { value: string } | undefined } },
  name: string,
): boolean {
  const c = res.cookies.get(name);
  return c === undefined || c.value === '';
}

describe('GET /api/auth/callback (Authorization Code + PKCE)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });

  it('exchanges the code (with code_verifier) and sets fleet_session, then redirects home', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: VALID_JWT, expires_in: 300 }), {
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
    expect(session?.value).toBe(VALID_JWT);
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
    const res = await GET(
      makeReq({ code: 'c', state: 'state-URL-DIFFERENT' }, transient('state-COOKIE')),
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 400 }))),
    );
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'c', state: 'state-1' }, transient()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get('fleet_session')).toBeUndefined();
  });

  // Behind a reverse proxy (Railway), req.url's host is the container's internal
  // bind (0.0.0.0:3001). Building redirects from req.url would send the browser
  // to https://0.0.0.0:3001/ (ERR_ADDRESS_INVALID). The handler must instead use
  // the public origin. These guard that regression.
  function makeReqInternalBind(
    query: Record<string, string>,
    cookies: Record<string, string>,
    headers: Record<string, string> = {},
  ): NextRequest {
    // Simulate the request as the container sees it: internal-bind host.
    const url = new URL('http://0.0.0.0:3001/api/auth/callback');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const req = new NextRequest(url, { headers });
    for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
    return req;
  }
  function okTokenFetch(): ReturnType<typeof vi.fn> {
    return vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: VALID_JWT, expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  }
  it('redirects to the X-Forwarded-Host (not the internal bind) on success', async () => {
    vi.stubGlobal('fetch', okTokenFetch());
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(
      makeReqInternalBind({ code: 'auth-code-1', state: 'state-1' }, transient(), {
        'x-forwarded-host': 'xe.public.example',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://xe.public.example/');
    expect(res.headers.get('location')).not.toContain('0.0.0.0');
  });
  it('falls back to OIDC_REDIRECT_URI origin (never 0.0.0.0) when no forwarded host', async () => {
    vi.stubGlobal('fetch', okTokenFetch());
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(
      makeReqInternalBind({ code: 'auth-code-1', state: 'state-1' }, transient()),
    );
    expect(res.status).toBe(307);
    // OIDC_REDIRECT_URI origin is https://ops.example.com -> redirect home there.
    expect(res.headers.get('location')).toBe('https://ops.example.com/');
    expect(res.headers.get('location')).not.toContain('0.0.0.0');
  });
  it('builds the /login error redirect against the public origin too', async () => {
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(
      makeReqInternalBind({ code: 'c', state: 'state-WRONG' }, transient('state-COOKIE'), {
        'x-forwarded-host': 'xe.public.example',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('https://xe.public.example/login');
    expect(location).not.toContain('0.0.0.0');
  });

  // STRICT STEP-UP ENFORCEMENT: even after a successful code->token exchange, the
  // callback must REFUSE a token that does not prove the passwordless guarantee
  // (Google-brokered + aal3 passkey). fleet_session must NOT be set on refusal.
  function tokenFetchReturning(accessToken: string): ReturnType<typeof vi.fn> {
    return vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: accessToken, expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  }
  it('REJECTS a token below aal3 (TOTP/aal2) -> /login?error=insufficient_acr, no session', async () => {
    vi.stubGlobal('fetch', tokenFetchReturning(makeAccessJwt({ acr: 'aal2', idp: 'google' })));
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'auth-code-1', state: 'state-1' }, transient()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.headers.get('location')).toContain('error=insufficient_acr');
    expect(res.cookies.get('fleet_session')).toBeUndefined();
  });
  it('REJECTS a non-Google-brokered token -> /login?error=idp_not_brokered, no session', async () => {
    vi.stubGlobal('fetch', tokenFetchReturning(makeAccessJwt({ acr: 'aal3' })));
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'auth-code-1', state: 'state-1' }, transient()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.headers.get('location')).toContain('error=idp_not_brokered');
    expect(res.cookies.get('fleet_session')).toBeUndefined();
  });
  it('REJECTS an access token that is not a decodable JWT -> /login, no session', async () => {
    vi.stubGlobal('fetch', tokenFetchReturning('opaque-not-a-jwt'));
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'auth-code-1', state: 'state-1' }, transient()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get('fleet_session')).toBeUndefined();
  });
  it('ACCEPTS a Google-brokered aal3 passkey token -> sets fleet_session', async () => {
    vi.stubGlobal('fetch', tokenFetchReturning(makeAccessJwt({ acr: 'aal3', idp: 'google' })));
    const { GET } = await import('@/app/api/auth/callback/route');
    const res = await GET(makeReq({ code: 'auth-code-1', state: 'state-1' }, transient()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/$|ops\.example\.com\/$/);
    expect(res.cookies.get('fleet_session')?.value).toBeDefined();
  });
});
