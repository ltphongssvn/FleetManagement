// apps/ops-web/test/create-order-action.test.ts
// RED: createOrder server action POSTs to /transport-orders with bearer cookie token.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
describe('createOrder server action', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    redirect.mockClear();
    revalidatePath.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('rejects when externalRef missing', async () => {
    cookieGet.mockReturnValue({ value: 'tok' });
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('externalRef', '');
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    const r = await createOrder(undefined, fd);
    expect(r).toMatchObject({ status: 'invalid', errors: { externalRef: 'Required' } });
  });
  it('posts to api with bearer token and redirects on success', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt-abc' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1' }), { status: 201, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('externalRef', 'TO-9001');
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('pickupAt', '2026-05-08T09:00');
    fd.set('deliveryAt', '2026-05-08T11:00');
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(fetchMock).toHaveBeenCalledWith('http://api:3000/transport-orders', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer jwt-abc', 'Content-Type': 'application/json' }),
    }));
    expect(revalidatePath).toHaveBeenCalledWith('/');
    expect(redirect).toHaveBeenCalledWith('/');
  });
  it('returns api_error when api fails', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'bad' }), { status: 400 }))));
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('externalRef', 'TO-X');
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('pickupAt', '2026-05-08T09:00');
    fd.set('deliveryAt', '2026-05-08T11:00');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'api_error', message: expect.stringContaining('400') });
  });
});
