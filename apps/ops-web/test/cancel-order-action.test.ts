// apps/ops-web/test/cancel-order-action.test.ts
// L2 tests for the cancelOrder server action.
//
// Success contract (T5 follow-on): on a successful API cancel the action
// revalidates the affected paths and then calls redirect('/'). Because
// next/navigation's real redirect throws a NEXT_REDIRECT error we mock
// it as a vi.fn that throws an identifiable sentinel; the test then
// catches and asserts on the call args. Idempotent retries (API echoes
// idempotent=true) follow the same path.
//
// Auth contract (hotfix 2026): a missing/expired fleet_session no longer
// returns server_error. The proxy now passes Server Action POSTs through
// untouched (it cannot forward a rewrite/redirect for an action response), so
// the action OWNS auth and redirects an unauthenticated caller to /login via the
// same Server-Action redirect protocol used for the success path. This is the
// defense-in-depth the Next.js 2026 guidance prescribes (proxy.ts is a UX layer,
// not a security boundary). A genuine config fault (FLEET_API_URL unset) is still
// a server_error — that is not an auth condition.
//
// Other error paths still return discriminated-union values: invalid,
// server_error (config), api_error, not_found, conflict.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
class NextRedirectError extends Error {
  digest: string;
  constructor(to: string) {
    super('NEXT_REDIRECT');
    this.digest = 'NEXT_REDIRECT;replace;' + to + ';303;';
  }
}
const redirect = vi.fn((to: string) => {
  throw new NextRedirectError(to);
});
vi.mock('next/navigation', () => ({ redirect }));
const VALID_ID = '11111111-1111-1111-1111-111111111111';
function defined<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected defined result');
  return v;
}
describe('cancelOrder server action (T5)', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    revalidatePath.mockClear();
    redirect.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('redirects to / and revalidates both the review page and the board on success', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt-abc' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: VALID_ID, idempotent: false, state: 'cancelled' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    fd.set('note', 'cancellation note');
    let caught: unknown;
    try {
      await cancelOrder(undefined, fd);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NextRedirectError);
    expect(redirect).toHaveBeenCalledWith('/');
    expect(revalidatePath).toHaveBeenCalledWith('/dispatch/orders/' + VALID_ID);
    expect(revalidatePath).toHaveBeenCalledWith('/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as [string, { method: string; body: string; headers: Record<string, string> }][];
    const first = calls[0];
    if (!first) throw new Error('no fetch call');
    expect(first[0]).toBe('http://api:3000/transport-orders/' + VALID_ID + '/cancel');
    expect(first[1].method).toBe('POST');
    expect(first[1].headers['Authorization']).toBe('Bearer jwt-abc');
    const body = JSON.parse(first[1].body);
    expect(body).toEqual({ reason: 'customer_request', note: 'cancellation note' });
  });
  it('redirects to / on an idempotent retried cancel too', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: VALID_ID, idempotent: true, state: 'cancelled' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))));
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    let caught: unknown;
    try {
      await cancelOrder(undefined, fd);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NextRedirectError);
    expect(redirect).toHaveBeenCalledWith('/');
  });
  it('returns invalid when transportOrderId is not a uuid', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', 'not-a-uuid');
    fd.set('reason', 'customer_request');
    const r = defined(await cancelOrder(undefined, fd));
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') throw new Error('not invalid');
    expect(r.errors.transportOrderId).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
  it('returns invalid when reason is not in the allow-list', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'unicorn_strike');
    const r = defined(await cancelOrder(undefined, fd));
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') throw new Error('not invalid');
    expect(r.errors.reason).toBeTruthy();
  });
  it('returns server_error when FLEET_API_URL is missing', async () => {
    vi.stubEnv('FLEET_API_URL', '');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    const r = await cancelOrder(undefined, fd);
    expect(r).toEqual({ status: 'server_error', message: expect.stringContaining('chưa được cấu hình') });
  });
  it('redirects to /login when the auth cookie is missing (expired session)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    let caught: unknown;
    try {
      await cancelOrder(undefined, fd);
    } catch (e) {
      caught = e;
    }
    // The unauthenticated caller is redirected to /login (Server-Action redirect
    // protocol throws), NOT given a server_error, and the API is never called.
    expect(caught).toBeInstanceOf(NextRedirectError);
    expect(redirect).toHaveBeenCalledWith('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns not_found when the API returns 404', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ message: 'Transport order not found' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ))));
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    const r = defined(await cancelOrder(undefined, fd));
    expect(r.status).toBe('not_found');
    expect(redirect).not.toHaveBeenCalled();
  });
  it('returns conflict when the API returns 409', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ message: 'Transport order cannot be cancelled from state: completed' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ))));
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    const r = defined(await cancelOrder(undefined, fd));
    expect(r.status).toBe('conflict');
    expect(redirect).not.toHaveBeenCalled();
  });
  it('returns api_error for other non-2xx API responses', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ message: 'boom' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    ))));
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    const r = defined(await cancelOrder(undefined, fd));
    expect(r.status).toBe('api_error');
    if (r.status !== 'api_error') throw new Error('not api_error');
    // Contract change (error-presentation arc): 5xx maps to the immutable
    // server-error Vietnamese; raw digits never reach a dispatcher.
    expect(r.message).toBe('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');
  });

  it('returns api_error with the status-class copy even when the error body cannot be read', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not json', { status: 500 }))));
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'customer_request');
    const r = defined(await cancelOrder(undefined, fd));
    expect(r.status).toBe('api_error');
    if (r.status !== 'api_error') throw new Error('not api_error');
    expect(r.message).toBe('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');
  });
  it('drops a stale note when it is an empty string (treats it as unset)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: VALID_ID, idempotent: false, state: 'cancelled' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'weather');
    fd.set('note', '');
    try {
      await cancelOrder(undefined, fd);
    } catch {
      // expected NextRedirect throw
    }
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const first = calls[0];
    if (!first) throw new Error('no fetch call');
    const body = JSON.parse(first[1].body);
    expect(body).toEqual({ reason: 'weather' });
    expect(body.note).toBeUndefined();
  });
  it('returns invalid (errors.note) when reason=other has no note, and never calls the API', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'other');
    const r = defined(await cancelOrder(undefined, fd));
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') throw new Error('not invalid');
    expect(r.errors.note).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
  it('accepts reason=other WITH a note and forwards both to the API', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: VALID_ID, idempotent: false, state: 'cancelled' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { cancelOrder } = await import('@/features/dispatch/cancel-order.action');
    const fd = new FormData();
    fd.set('transportOrderId', VALID_ID);
    fd.set('reason', 'other');
    fd.set('note', 'khách đổi lịch');
    try {
      await cancelOrder(undefined, fd);
    } catch {
      // expected NextRedirect throw on success
    }
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const first = calls[0];
    if (!first) throw new Error('no fetch call');
    const body = JSON.parse(first[1].body);
    expect(body).toEqual({ reason: 'other', note: 'khách đổi lịch' });
  });
});
