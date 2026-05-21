// apps/ops-web/test/create-order-multi-pickup.test.ts
// createOrder: dynamic pickup AND delivery warehouses with no hard cap.
// Pickups share one pickupAt; deliveries share one deliveryAt. The dispatcher
// may add a 5th, 6th... warehouse on either side. Empty slots are dropped;
// >=1 pickup and >=1 delivery required.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
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
  fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
  fd.set('pickupAt', '2026-05-10T09:00');
  fd.set('deliveryAt', '2026-05-15T11:00');
  return fd;
}
describe('createOrder dynamic pickup + delivery warehouses (no hard cap)', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    redirect.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('accepts more than 4 pickup warehouses (5th, 6th...)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    for (let i = 1; i <= 6; i++) fd.set('pickupWarehouse_' + String(i), 'Kho ' + String(i));
    fd.set('deliveryWarehouse_1', 'DA NANG');
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    const stops = lastBody(fetchMock)['stops'] as { stopType: string }[];
    expect(stops.filter((s) => s.stopType === 'pickup')).toHaveLength(6);
    expect(stops.filter((s) => s.stopType === 'delivery')).toHaveLength(1);
  });
  it('accepts more than 1 delivery warehouse (2nd, 3rd...)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    fd.set('pickupWarehouse_1', 'Kho 1');
    for (let i = 1; i <= 3; i++) fd.set('deliveryWarehouse_' + String(i), 'Dest ' + String(i));
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    const stops = lastBody(fetchMock)['stops'] as { sequence: number; stopType: string }[];
    expect(stops.filter((s) => s.stopType === 'pickup')).toHaveLength(1);
    expect(stops.filter((s) => s.stopType === 'delivery')).toHaveLength(3);
    expect(stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
  });
  it('pickup stops share one date, delivery stops share another', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    fd.set('pickupWarehouse_1', 'Kho 1');
    fd.set('pickupWarehouse_2', 'Kho 2');
    fd.set('deliveryWarehouse_1', 'Dest 1');
    fd.set('deliveryWarehouse_2', 'Dest 2');
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    const stops = lastBody(fetchMock)['stops'] as { stopType: string; plannedAt: string }[];
    const pAt = new Set(stops.filter((s) => s.stopType === 'pickup').map((s) => s.plannedAt));
    const dAt = new Set(stops.filter((s) => s.stopType === 'delivery').map((s) => s.plannedAt));
    expect(pAt.size).toBe(1);
    expect(dAt.size).toBe(1);
    expect([...pAt][0]).not.toBe([...dAt][0]);
  });
  it('drops empty warehouse slots on both sides', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    fd.set('pickupWarehouse_1', 'Kho 1');
    fd.set('pickupWarehouse_2', '');
    fd.set('pickupWarehouse_3', 'Kho 3');
    fd.set('deliveryWarehouse_1', '');
    fd.set('deliveryWarehouse_2', 'Dest 2');
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    const stops = lastBody(fetchMock)['stops'] as { stopType: string }[];
    expect(stops.filter((s) => s.stopType === 'pickup')).toHaveLength(2);
    expect(stops.filter((s) => s.stopType === 'delivery')).toHaveLength(1);
  });
  it('rejects when no pickup warehouse is assigned', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 201 }))));
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    fd.set('deliveryWarehouse_1', 'DA NANG');
    expect(await createOrder(undefined, fd)).toMatchObject({ status: 'invalid' });
  });
  it('rejects when no delivery warehouse is assigned', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 201 }))));
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = baseForm();
    fd.set('pickupWarehouse_1', 'Kho 1');
    expect(await createOrder(undefined, fd)).toMatchObject({ status: 'invalid' });
  });
});
