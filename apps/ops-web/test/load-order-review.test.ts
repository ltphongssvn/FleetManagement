// apps/ops-web/test/load-order-review.test.ts
// RED->GREEN: server-only loader for the dispatcher order-review page.
//
// ROOT CAUSE THIS CLOSES (2026-07-23): the review page was an RSC that fetched
// its OWN BFF route, building the absolute URL from the incoming host header
// (bffBaseUrl -> http://<host>/api/transport-orders/<id>). That is the
// documented Next.js anti-pattern -- the Next team is explicit that a server
// component should fetch from the SOURCE, never make the extra jump through its
// own route handler, because the server ends up fetching data from itself while
// pretending itself as a separate server.
//
// It also breaks outright the moment the PUBLISHED port differs from the port
// the container LISTENS on. compose.yaml maps ${FLEET_PORT_OPS_WEB:-3001}:3001,
// so on the default stack (3001:3001) the self-fetch coincidentally worked,
// while on the isolated per-worktree stack (e.g. 25021:3001) the host header
// said localhost:25021 and NOTHING listens on 25021 inside the container. The
// fetch failed, the page threw, and the framework rendered the error boundary
// (Da xay ra loi) -- with every BROWSER request still 200, because the failing
// request was server-side and invisible to the trace.
//
// The fix mirrors the loader that already works on both stacks,
// loadDispatchBoard: fetch FLEET_API_URL (the in-network address, immune to
// published host ports) directly with the fleet_session bearer, then parse the
// response at the trust boundary against the SSOT ListAssignedRowSchema.
const cookieGet = vi.fn(() => ({ value: 'test-token' }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// A complete row matching the SSOT contract (ListAssignedRowSchema).
const apiRow = {
  transportOrderId: 'aaaaaaaa-1111-4111-8111-111111111111',
  externalRef: 'XTT.07-010',
  orderRef: 'XTT.07-010',
  roadRunId: 'bbbbbbbb-2222-4222-8222-222222222222',
  state: 'planned',
  plannedStartAt: '2026-07-23T08:00:00.000Z',
  createdAt: '2026-07-23T07:00:00.000Z',
  startedAt: null,
  completedAt: null,
  plate: '62H 05194',
  customerName: 'E2E-KHACH',
  cargoName: null,
  driverName: 'E2E DRIVER',
  pickupName: 'Kho A',
  deliveryName: 'Kho B',
  stops: [],
  canCancel: true,
  cancelBlockedReason: null,
};

describe('loadOrderReview', () => {
  it('fetches the API DIRECTLY via FLEET_API_URL, never its own BFF host', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(apiRow),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await loadOrderReview('XTT.07-010');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:3000/transport-orders/XTT.07-010',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('never builds the URL from a host header (no localhost/port coupling)', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(apiRow),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await loadOrderReview('XTT.07-010');
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    // The published host port (e.g. 25021 on an isolated stack) must never
    // appear: the in-network API address is the only correct target.
    expect(calledUrl.includes('localhost')).toBe(false);
    expect(calledUrl.startsWith('http://api:3000/')).toBe(true);
  });

  it('url-encodes the id/ref so an external_ref with a dot is safe', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(apiRow),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await loadOrderReview('XTT.07-010');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(encodeURIComponent('XTT.07-010'));
  });

  it('parses the response at the trust boundary against the SSOT schema', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(apiRow),
      }),
    );
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    const row = await loadOrderReview('XTT.07-010');
    expect(row.transportOrderId).toBe(apiRow.transportOrderId);
    expect(row.externalRef).toBe('XTT.07-010');
    expect(row.canCancel).toBe(true);
  });

  it('throws a descriptive error when the response shape drifts', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ wrong: 'shape' }),
      }),
    );
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await expect(loadOrderReview('XTT.07-010')).rejects.toThrow(/shape invalid/);
  });

  it('signals NOT FOUND (not a throw) when the API answers 404', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }),
    );
    const notFoundMock = vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    vi.doMock('next/navigation', () => ({ notFound: notFoundMock, redirect: vi.fn() }));
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await expect(loadOrderReview('XTT.07-999')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });

  // Idle-expired session: a TOP-LEVEL navigation to the silent-refresh route is
  // required so the rotated cookie pair reaches the browser; forwarding
  // fleet_refresh into this internal fetch would trip RFC 9700 reuse detection.
  // Contract pinned by order-review-page-session-expired.test.ts.
  it('redirects to the silent-refresh route when the API answers 401', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      }),
    );
    const redirectMock = vi.fn((url: string) => {
      throw new Error('NEXT_REDIRECT:' + url);
    });
    vi.doMock('next/navigation', () => ({ notFound: vi.fn(), redirect: redirectMock }));
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await expect(loadOrderReview('XTT.07-001')).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledWith(
      '/api/auth/refresh?next=' + encodeURIComponent('/dispatch/orders/XTT.07-001'),
    );
  });

  // Message contract also pinned by order-review-page-session-expired.test.ts:
  // non-auth failures keep the descriptive throw carrying the status. Going
  // direct to the API must not change what the boundary reports.
  it('throws the pinned load-failure message on other failures', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env['FLEET_API_URL'] = 'http://api:3000';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      }),
    );
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await expect(loadOrderReview('XTT.07-010')).rejects.toThrow(/Failed to load order: 503/);
  });

  it('throws in production when FLEET_API_URL is unset (no silent fallback)', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env['FLEET_API_URL'];
    const { loadOrderReview } = await import('../src/features/dispatch/load-order-review.js');
    await expect(loadOrderReview('XTT.07-010')).rejects.toThrow('FLEET_API_URL');
  });
});
