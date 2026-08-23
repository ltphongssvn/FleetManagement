// apps/ops-web/test/proxy.test.ts
// RED: middleware redirects unauthenticated requests to /login,
// allows /login itself, and lets authenticated requests through.
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
function makeReq(pathname: string, cookieValue?: string): NextRequest {
  return {
    nextUrl: new URL(`http://localhost:3001${pathname}`),
    url: `http://localhost:3001${pathname}`,
    headers: { get: (_n: string) => null },
    cookies: {
      get: (n: string) =>
        n === 'fleet_session' && cookieValue ? { value: cookieValue } : undefined,
    },
  } as unknown as NextRequest;
}
describe('auth middleware', () => {
  it('redirects to /login when no session cookie on protected route', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/'));
    expect(r).toEqual({ type: 'redirect', url: 'http://localhost:3001/login' });
  });
  it('allows /login through unauthenticated with Cache-Control: no-transform', async () => {
    // /login is a public HTML document; the edge would inject the beacon here
    // too, so it also carries no-transform to prevent the #418 mismatch.
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/login'));
    expect(r.type).toBe('next');
    expect(r.headers.get('cache-control')).toContain('no-transform');
  });
  it('allows an authenticated request through with Cache-Control: no-transform', async () => {
    // no-transform stops the Cloudflare edge from injecting its Web Analytics
    // beacon into the HTML <body> (root cause of React #418). The authed page
    // pass-through is the HTML document response the edge would mutate.
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/', 'jwt-token'));
    expect(r.type).toBe('next');
    expect(r.headers.get('cache-control')).toContain('no-transform');
  });
});

describe('auth middleware matcher', () => {
  // The matcher decides which requests reach proxy() at all. The OAuth callback
  // (/api/auth/callback) must NOT be matched: it has to run its route handler
  // while still unauthenticated to exchange the code and set fleet_session. If
  // the matcher caught it, proxy() would redirect to /login before the handler
  // ran and login could never complete. This guards that regression.
  // Compile config.matcher[0] to an anchored regex. Throwing on a missing
  // pattern both documents the invariant and lets TS narrow to string without a
  // type assertion (the lint config forbids both `as string` and `!`).
  async function matcherRegex(): Promise<RegExp> {
    const { config } = await import('@/proxy');
    const pattern = config.matcher[0];
    if (typeof pattern !== 'string') throw new Error('proxy matcher pattern missing');
    // Next.js applies config.matcher as a path regex anchored at the start.
    return new RegExp(`^${pattern}$`);
  }
  it('does NOT match /api/auth/callback (callback handler must run)', async () => {
    expect((await matcherRegex()).test('/api/auth/callback')).toBe(false);
  });
  it('does NOT match other /api/auth/* paths', async () => {
    expect((await matcherRegex()).test('/api/auth/login')).toBe(false);
  });
  it('still matches a protected app route like /', async () => {
    expect((await matcherRegex()).test('/')).toBe(true);
  });
  it('still matches a protected route like /dispatch/orders/123', async () => {
    expect((await matcherRegex()).test('/dispatch/orders/123')).toBe(true);
  });
  it('still excludes the health probe and static assets', async () => {
    const re = await matcherRegex();
    expect(re.test('/api/health')).toBe(false);
    expect(re.test('/_next/static/chunk.js')).toBe(false);
  });
});
