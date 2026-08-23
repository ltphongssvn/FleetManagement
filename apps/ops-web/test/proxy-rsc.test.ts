// apps/ops-web/test/proxy-rsc.test.ts
// RED: an unauthenticated RSC request must NOT receive a plain 307 redirect
// to /login. Next.js drops the ?_rsc param on redirect and the router cannot
// consume an HTML redirect as an RSC payload, so it retries the prefetch in a
// tight loop until the browser exhausts sockets (ERR_INSUFFICIENT_RESOURCES).
//
// Critical detail verified at runtime: Next 16 STRIPS the 'Rsc' and
// 'Next-Router-Prefetch' request headers before middleware runs, so they are
// unreadable here. The signal that DOES survive to middleware is the Accept
// header: RSC requests send 'text/x-component', document requests send
// 'text/html'. The fix keys on that. For RSC requests we rewrite to /login so
// the router gets a valid RSC payload and navigates once; document requests
// keep the 307 redirect so the address bar updates.
//
// Business invariant: the review view (and every protected route) is always
// reachable; an expired/missing session lands the dispatcher on /login in one
// hop, never an unbounded retry loop.
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';
vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: 'next', headers: new Headers() })),
    redirect: vi.fn((url) => ({ type: 'redirect', url: url.toString() })),
    rewrite: vi.fn((url) => ({ type: 'rewrite', url: url.toString() })),
  },
}));
function makeReq(pathname: string, opts: { cookie?: string; accept?: string } = {}): NextRequest {
  const accept = opts.accept ?? 'text/html';
  return {
    nextUrl: new URL('http://localhost:3001' + pathname),
    url: 'http://localhost:3001' + pathname,
    headers: { get: (n: string) => (n.toLowerCase() === 'accept' ? accept : null) },
    cookies: {
      get: (n: string) =>
        n === 'fleet_session' && opts.cookie ? { value: opts.cookie } : undefined,
    },
  } as unknown as NextRequest;
}
describe('auth middleware — RSC prefetch loop guard', () => {
  it('rewrites (not redirects) an unauthenticated RSC request to /login', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/dispatch/orders/XTT.05-001', { accept: 'text/x-component' }));
    expect(r).toEqual({ type: 'rewrite', url: 'http://localhost:3001/login' });
  });
  it('rewrites when text/x-component appears among multiple Accept values', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(
      makeReq('/dispatch/orders/XTT.05-001', { accept: 'text/x-component;q=1, */*;q=0.1' }),
    );
    expect(r).toEqual({ type: 'rewrite', url: 'http://localhost:3001/login' });
  });
  it('still redirects an unauthenticated document (text/html) request', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/dispatch/orders/XTT.05-001', { accept: 'text/html' }));
    expect(r).toEqual({ type: 'redirect', url: 'http://localhost:3001/login' });
  });
  it('lets an authenticated RSC request through', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(
      makeReq('/dispatch/orders/XTT.05-001', { cookie: 'jwt', accept: 'text/x-component' }),
    );
    expect(r.type).toBe('next');
  });
});
