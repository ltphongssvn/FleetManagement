// apps/ops-web/test/proxy-api-json.test.ts
// RED-first: the proxy must NEVER answer an /api/* request with an HTML
// redirect/rewrite (clients JSON.parse and surface raw '<!DOCTYPE' noise).
// No cookies at all -> 401 problem+json (code UNAUTHORIZED, presenter maps to
// 'Phien dang nhap het han...'). A live fleet_refresh cookie -> pass through
// so the route handler silently refreshes. Pages keep today's behavior when
// no refresh cookie exists, and bounce through /api/auth/refresh when one does.
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => ({ type: 'next', headers: new Headers() })),
    redirect: vi.fn((url: URL) => ({ type: 'redirect', url: url.toString() })),
    rewrite: vi.fn((url: URL) => ({ type: 'rewrite', url: url.toString() })),
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      type: 'json',
      body,
      status: init?.status,
    })),
  },
}));

import { proxy } from '../src/proxy';

function makeReq(pathname: string, cookies: Record<string, string> = {}): never {
  return {
    nextUrl: new URL('http://localhost:3001' + pathname),
    url: 'http://localhost:3001' + pathname,
    headers: new Headers(),
    cookies: {
      get: (n: string) => (cookies[n] !== undefined ? { value: cookies[n] } : undefined),
    },
  } as never;
}

describe('proxy api passthrough contract', () => {
  it('answers an unauthenticated /api/* request with 401 JSON, never a redirect', () => {
    const r = proxy(makeReq('/api/copilot/plan')) as never as {
      type: string;
      status?: number;
      body?: { code?: string };
    };
    expect(r.type).toBe('json');
    expect(r.status).toBe(401);
    expect(r.body?.code).toBe('UNAUTHORIZED');
  });

  it('lets an /api/* request through when only fleet_refresh is present (silent refresh downstream)', () => {
    const r = proxy(makeReq('/api/reference/customers', { fleet_refresh: 'r1' })) as never as {
      type: string;
    };
    expect(r.type).toBe('next');
  });

  it('bounces a page navigation with only fleet_refresh through /api/auth/refresh', () => {
    const r = proxy(makeReq('/dispatch', { fleet_refresh: 'r1' })) as never as {
      type: string;
      url: string;
    };
    expect(r.type).toBe('redirect');
    const u = new URL(r.url);
    expect(u.pathname).toBe('/api/auth/refresh');
    expect(u.searchParams.get('next')).toBe('/dispatch');
  });

  it('still sends a cookieless page navigation to /login', () => {
    const r = proxy(makeReq('/dispatch')) as never as { type: string; url: string };
    expect(r.type).toBe('redirect');
    expect(new URL(r.url).pathname).toBe('/login');
  });

  it('still lets an authenticated request straight through', () => {
    const r = proxy(makeReq('/dispatch', { fleet_session: 'a1' })) as never as { type: string };
    expect(r.type).toBe('next');
  });
});
