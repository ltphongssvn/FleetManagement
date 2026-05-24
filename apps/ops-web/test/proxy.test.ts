// apps/ops-web/test/proxy.test.ts
// RED: middleware redirects unauthenticated requests to /login,
// allows /login itself, and lets authenticated requests through.
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';
vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: 'next' })),
    redirect: vi.fn((url) => ({ type: 'redirect', url: url.toString() })),
  },
}));
function makeReq(pathname: string, cookieValue?: string): NextRequest {
  return {
    nextUrl: new URL(`http://localhost:3001${pathname}`),
    url: `http://localhost:3001${pathname}`,
    cookies: { get: (n: string) => (n === 'fleet_session' && cookieValue ? { value: cookieValue } : undefined) },
  } as unknown as NextRequest;
}
describe('auth middleware', () => {
  it('redirects to /login when no session cookie on protected route', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/'));
    expect(r).toEqual({ type: 'redirect', url: 'http://localhost:3001/login' });
  });
  it('allows /login through unauthenticated', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/login'));
    expect(r).toEqual({ type: 'next' });
  });
  it('allows authenticated request through', async () => {
    const { proxy } = await import('@/proxy');
    const r = proxy(makeReq('/', 'jwt-token'));
    expect(r).toEqual({ type: 'next' });
  });
});
