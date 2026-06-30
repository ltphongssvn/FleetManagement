// apps/ops-web/test/proxy-server-action.test.ts
// Hotfix (2026) RED — the auth proxy must NEVER divert a Server Action request
// to /login. A Cancel click is a Server Action POST fired against the current
// protected route (/dispatch/orders/:id) and carries the Next-Action request
// header. Next.js cannot forward a rewrite/redirect for a Server Action
// response, so when the proxy sees Accept: text/x-component + no session and
// rewrites to /login, the action client receives the /login payload instead of
// an action result and throws "An unexpected response was received from the
// server" (proven live: HTTP 404, x-nextjs-action-not-found:1,
// x-middleware-rewrite:/login, body "Server action not found.").
//
// Fix model (Next.js 2026 guidance, vercel/next.js discussion #64993 + the May
// 2026 auth-security advisories): proxy.ts is a UX/redirect layer, NOT a
// security boundary (cf. CVE-2025-29927). Server Actions are public POST
// endpoints that must authenticate themselves, so the proxy lets Next-Action
// requests pass and the action enforces auth (cancelOrder redirects an
// unauthenticated caller to /login). Detector: the Next-Action request header.
//
// Test 1 FAILS on the current proxy (rewrite -> /login) and PASSES once proxy()
// short-circuits Next-Action requests with NextResponse.next(). Test 3 pins the
// prior RSC-prefetch-loop guard: a plain RSC navigation (no Next-Action) still
// rewrites to /login, so this fix does not regress that behavior.
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';
vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: 'next' })),
    redirect: vi.fn((url) => ({ type: 'redirect', url: url.toString() })),
    rewrite: vi.fn((url) => ({ type: 'rewrite', url: url.toString() })),
  },
}));
function makeReq(
  pathname: string,
  opts: { cookie?: string; accept?: string; nextAction?: string } = {},
): NextRequest {
  const accept = opts.accept ?? 'text/x-component';
  return {
    nextUrl: new URL('http://localhost:3001' + pathname),
    url: 'http://localhost:3001' + pathname,
    headers: {
      get: (n: string) => {
        const key = n.toLowerCase();
        if (key === 'accept') return accept;
        if (key === 'next-action') return opts.nextAction ?? null;
        return null;
      },
    },
    cookies: {
      get: (n: string) => (n === 'fleet_session' && opts.cookie ? { value: opts.cookie } : undefined),
    },
  } as unknown as NextRequest;
}
describe('auth proxy — Server Action requests are never diverted to /login', () => {
  it('lets an UNauthenticated Server Action POST through (next, not rewrite/redirect)', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/dispatch/orders/XTT.05-002', { accept: 'text/x-component', nextAction: 'deadbeef' }));
    expect(r).toEqual({ type: 'next' });
  });
  it('lets an authenticated Server Action POST through as well', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/dispatch/orders/XTT.05-002', { cookie: 'jwt', accept: 'text/x-component', nextAction: 'deadbeef' }));
    expect(r).toEqual({ type: 'next' });
  });
  it('still rewrites an unauthenticated RSC navigation (no Next-Action) to /login', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/dispatch/orders/XTT.05-002', { accept: 'text/x-component' }));
    expect(r).toEqual({ type: 'rewrite', url: 'http://localhost:3001/login' });
  });
});
