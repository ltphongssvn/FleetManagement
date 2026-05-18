// apps/ops-web/test/create-order-multi-destination.test.ts
// RED: createOrder must accept 1..4 delivery destinations in a single order,
// emitting one pickup stop + N delivery stops (sequence 1..N+1) and rejecting >4.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
function lastBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
  const c = calls[0];
  if (!c) throw new Error('no fetch call');
  return JSON.parse(c[1].body) as Record<string, unknown>;
}
function baseForm(): FormData {
  const fd = new FormData();
  fd.set('externalRef', 'XTT.05-001');
  fd.set('plannedStartAt', '2026-05-09T08:00');
  fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
  fd.set('pickupAt', '2026-05-10T09:00');
  return fd;
}
describe('createOrder multi-destination (max 4 per order)', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    redirect.mockClear();
    revalidatePath.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('emits 1 pickup + 4 delivery stops for a 4-destination order', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    for (let i = 1; i <= 4; i++) {
      fd.set('deliveryAt_' + String(i), '2026-05-1' + String(i) + 'T11:00');
      fd.set('deliveryWarehouse_' + String(i), 'Kho ' + String(i));
    }
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    const body = lastBody(fetchMock);
    const stops = body['stops'] as { sequence: number; stopType: string }[];
    expect(stops).toHaveLength(5);
    expect(stops[0]).toMatchObject({ sequence: 1, stopType: 'pickup' });
    expect(stops.filter((s) => s.stopType === 'delivery')).toHaveLength(4);
    expect(stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5]);
  });
  it('accepts a single-destination order (1 pickup + 1 delivery)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    fd.set('deliveryAt_1', '2026-05-15T11:00');
    fd.set('deliveryWarehouse_1', 'DA NANG');
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    const stops = lastBody(fetchMock)['stops'] as { stopType: string }[];
    expect(stops).toHaveLength(2);
    expect(stops.filter((s) => s.stopType === 'delivery')).toHaveLength(1);
  });
  it('rejects an order with more than 4 destinations', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 201 }))));
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    for (let i = 1; i <= 5; i++) {
      fd.set('deliveryAt_' + String(i), '2026-05-1' + String(i) + 'T11:00');
    }
    const r = await createOrder(undefined, fd);
    expect(r).toMatchObject({ status: 'invalid' });
  });
  it('rejects an order with zero destinations', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 201 }))));
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const r = await createOrder(undefined, baseForm());
    expect(r).toMatchObject({ status: 'invalid' });
  });
});
