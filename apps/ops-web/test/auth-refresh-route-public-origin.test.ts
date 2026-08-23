// apps/ops-web/test/auth-refresh-route-public-origin.test.ts
// RED (T11 idle-timeout arc, Facet B): /api/auth/refresh builds BOTH its
// redirects from req.url. Behind Railway the request host is the container
// internal bind (0.0.0.0:3001), so an idle dispatcher whose refresh token
// also expired was sent to https://0.0.0.0:3001/login?error=session_expired
// -> ERR_ADDRESS_INVALID (prod screenshot 2026-07-11). Contract pinned here,
// mirroring the callback suite: prefer x-forwarded-host/proto, fall back to
// the OIDC_REDIRECT_URI origin, never 0.0.0.0 -- on the session_expired fail
// path AND the success next= return path. Rotated cookies must ride the
// redirect RESPONSE (vercel/next.js#47126 lesson), and next= stays same-site
// (no scheme-relative // open redirect).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const TOKEN_EP = 'https://kc.example.com/realms/fleet/protocol/openid-connect/token';
const MINTED = 'minted.access.token';
const ROTATED = 'rotated-refresh-token';

function makeReq(
  query: Record<string, string>,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
): NextRequest {
  // Simulate the request as the container sees it: internal-bind host.
  const url = new URL('http://0.0.0.0:3001/api/auth/refresh');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new NextRequest(url, { headers });
  for (const [k, v] of Object.entries(cookies)) req.cookies.set(k, v);
  return req;
}

const FWD = { 'x-forwarded-host': 'xe.public.example', 'x-forwarded-proto': 'https' };

function okTokenFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ access_token: MINTED, refresh_token: ROTATED, expires_in: 300 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
}

function isCleared(
  res: { cookies: { get: (n: string) => { value: string } | undefined } },
  name: string,
): boolean {
  const c = res.cookies.get(name);
  return c === undefined || c.value === '';
}

describe('GET /api/auth/refresh builds redirects against the PUBLIC origin', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubEnv('OIDC_TOKEN_ENDPOINT', TOKEN_EP);
    vi.stubEnv('OIDC_CLIENT_ID', 'ops-web');
    vi.stubEnv('OIDC_REDIRECT_URI', 'https://ops.example.com/api/auth/callback');
  });

  it('fail path (no refresh cookie) -> forwarded-host /login?error=session_expired, cookies cleared, never 0.0.0.0', async () => {
    const { GET } = await import('@/app/api/auth/refresh/route');
    const res = await GET(makeReq({ next: '/admin/drivers' }, {}, FWD));
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('https://xe.public.example/login?error=session_expired');
    expect(location).not.toContain('0.0.0.0');
    expect(isCleared(res, 'fleet_session')).toBe(true);
    expect(isCleared(res, 'fleet_refresh')).toBe(true);
  });

  it('fail path without forwarded headers -> OIDC_REDIRECT_URI origin, never 0.0.0.0', async () => {
    const { GET } = await import('@/app/api/auth/refresh/route');
    const res = await GET(makeReq({}, {}));
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('https://ops.example.com/login?error=session_expired');
    expect(location).not.toContain('0.0.0.0');
  });

  it('success path -> re-mints, returns to next= on the forwarded host, rotated pair rides the redirect', async () => {
    vi.stubGlobal('fetch', okTokenFetch());
    const { GET } = await import('@/app/api/auth/refresh/route');
    const res = await GET(makeReq({ next: '/admin/drivers' }, { fleet_refresh: 'old-rt' }, FWD));
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBe('https://xe.public.example/admin/drivers');
    expect(location).not.toContain('0.0.0.0');
    const session = res.cookies.get('fleet_session');
    expect(session?.value).toBe(MINTED);
    expect(session?.httpOnly).toBe(true);
    expect(res.cookies.get('fleet_refresh')?.value).toBe(ROTATED);
  });

  it('rejects a scheme-relative next (//evil.com) -> lands on / of the public origin', async () => {
    vi.stubGlobal('fetch', okTokenFetch());
    const { GET } = await import('@/app/api/auth/refresh/route');
    const res = await GET(makeReq({ next: '//evil.com' }, { fleet_refresh: 'old-rt' }, FWD));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://xe.public.example/');
  });
});
