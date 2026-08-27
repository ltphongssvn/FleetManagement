// apps/ops-web/test/proxy-public-origin.test.ts
// RED (T11 idle-timeout arc, follow-up): the auth middleware built its
// redirect Location from req.url. Behind Railway that host is the container
// internal bind, so an idle-expired PAGE navigation (e.g. clicking the
// relative back link href=/ on Quan ly tai xe & xe) was redirected to
// https://0.0.0.0:3001/api/auth/refresh (or /login) -> ERR_ADDRESS_INVALID
// (prod screenshot 2026-07-12). Both middleware redirects must build against
// the PUBLIC origin (x-forwarded-host/proto), never 0.0.0.0. The RSC rewrite
// stays internal (browser never sees it) and is unaffected.
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: 'next', headers: new Headers() })),
    redirect: vi.fn((url) => ({ type: 'redirect', url: url.toString() })),
    json: vi.fn((body, init) => ({ type: 'json', body, status: init?.status })),
    rewrite: vi.fn((url) => ({ type: 'rewrite', url: url.toString() })),
  },
}));

// Simulate the request as the container sees it: internal-bind host on url/
// nextUrl, with the proxy-set forwarded headers carrying the PUBLIC host.
function makeReq(
  pathname: string,
  opts: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
): NextRequest {
  const cookies = opts.cookies ?? {};
  const headers = opts.headers ?? {};
  return {
    nextUrl: new URL('http://0.0.0.0:3001' + pathname),
    url: 'http://0.0.0.0:3001' + pathname,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    cookies: { get: (n: string) => (cookies[n] !== undefined ? { value: cookies[n] } : undefined) },
  } as unknown as NextRequest;
}

const FWD = { 'x-forwarded-host': 'xe.public.example', 'x-forwarded-proto': 'https' };

describe('auth middleware builds redirects against the public origin', () => {
  it('expired-session page nav with fleet_refresh -> refresh bounce on the public host, never 0.0.0.0', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/admin/drivers', { cookies: { fleet_refresh: 'rt' }, headers: FWD }));
    expect(r.type).toBe('redirect');
    expect(r.url).toBe(
      'https://xe.public.example/api/auth/refresh?next=' + encodeURIComponent('/admin/drivers'),
    );
    expect(r.url).not.toContain('0.0.0.0');
  });

  it('no session and no refresh -> /login on the public host, never 0.0.0.0', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/admin/drivers', { headers: FWD }));
    expect(r.type).toBe('redirect');
    expect(r.url).toBe('https://xe.public.example/login');
    expect(r.url).not.toContain('0.0.0.0');
  });

  it('preserves the next query string on the refresh bounce', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(
      makeReq('/dispatch/orders/XTT.07-1', { cookies: { fleet_refresh: 'rt' }, headers: FWD }),
    );
    expect(r.url).toBe(
      'https://xe.public.example/api/auth/refresh?next=' +
        encodeURIComponent('/dispatch/orders/XTT.07-1'),
    );
  });
});
