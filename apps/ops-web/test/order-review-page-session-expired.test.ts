// apps/ops-web/test/order-review-page-session-expired.test.ts
// RED (T11 idle-timeout arc, P7 sweep, last surface): the order-review RSC
// loader forwards ONLY fleet_session to the API; after idle expiry it sends
// no cookie, the API answers 401, and the loader THROWS into the error
// boundary (dead-end). Pinned contract: 401 -> server-side redirect() to the
// silent-refresh route with next=<this order page> (loadDispatchBoard house
// pattern; a top-level navigation lets the rotated cookie pair ride
// legitimately -- forwarding fleet_refresh into an internal fetch would trip
// RFC 9700 reuse detection). 404 keeps notFound(); other failures keep the
// descriptive throw.
//
// 2026-07-23: the page no longer self-fetches its own BFF through the host
// header (that coupled the render to the PUBLISHED port and broke on any stack
// whose mapping is not 3001:3001). It now delegates to the server-only
// loadOrderReview loader, which calls FLEET_API_URL directly. This spec is
// unchanged in CONTRACT -- it still drives the page and asserts the same three
// behaviours -- but gains the server-only stub the sibling loader tests already
// use (load-board.test.ts), because the loader imports 'server-only' and the
// real package refuses to load outside a server component.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const cookieGet = vi.fn();
const headerGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGet }),
  headers: () => Promise.resolve({ get: headerGet }),
}));
const { redirectMock, notFoundMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error('NEXT_REDIRECT:' + url);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

function problemRes(status: number, code: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, code }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

async function callPage(id: string): Promise<unknown> {
  const { default: OrderReviewPage } = await import('@/app/dispatch/orders/[id]/page');
  return OrderReviewPage({ params: Promise.resolve({ id }) });
}

describe('OrderReviewPage loader on idle-expired session', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    headerGet.mockReset();
    redirectMock.mockClear();
    notFoundMock.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
    cookieGet.mockReturnValue(undefined);
    headerGet.mockImplementation((n: string) =>
      n === 'host' ? 'xe.public.example' : n === 'x-forwarded-proto' ? 'https' : null,
    );
    // The loader resolves the API from FLEET_API_URL (in-network address), so
    // it must be present for the page to reach the fetch under test at all.
    process.env['FLEET_API_URL'] = 'http://api:3000';
  });

  it('401 -> redirect() to the silent-refresh route with next=<this page>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(problemRes(401, 'UNAUTHORIZED'))),
    );
    await expect(callPage('XTT.07-001')).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      '/api/auth/refresh?next=' + encodeURIComponent('/dispatch/orders/XTT.07-001'),
    );
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('404 keeps notFound()', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    );
    await expect(callPage('missing')).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('non-auth failures keep the descriptive throw (no redirect)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(problemRes(500, 'INTERNAL'))),
    );
    await expect(callPage('XTT.07-001')).rejects.toThrow(/Failed to load order: 500/);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
