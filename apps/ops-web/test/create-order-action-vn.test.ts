// apps/ops-web/test/create-order-action-vn.test.ts
// RED: createOrder accepts VN fields and sends them as transport_order metadata.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
describe('createOrder VN fields', () => {
  beforeEach(() => { cookieGet.mockReset(); redirect.mockClear(); vi.unstubAllGlobals(); vi.resetModules(); });
  it('sends VN metadata in body', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1' }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('externalRef', 'XT.001');
    fd.set('plannedStartAt', '2026-04-10T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('pickupAt', '2026-04-10T09:00');
    fd.set('deliveryAt', '2026-04-10T11:00');
    fd.set('customer', 'ĐẠI THÀNH');
    fd.set('cargo', 'GẠO');
    fd.set('vehiclePlate', '62H 05817');
    fd.set('driverName', 'LÊ VĂN CHÂU');
    fd.set('pickupWarehouse', 'Chơn Chính / Hậu Thạnh Đông');
    fd.set('backupWarehouse', 'Cường Thắng (Kiến Tường)');
    fd.set('deliveryWarehouse', '8 ĐẤT');
    await expect(createOrder(undefined, fd)).rejects.toThrow('NEXT_REDIRECT');
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body);
    expect(body.metadata).toEqual({
      customer: 'ĐẠI THÀNH',
      cargo: 'GẠO',
      vehiclePlate: '62H 05817',
      driverName: 'LÊ VĂN CHÂU',
      pickupWarehouse: 'Chơn Chính / Hậu Thạnh Đông',
      backupWarehouse: 'Cường Thắng (Kiến Tường)',
      deliveryWarehouse: '8 ĐẤT',
    });
  });
});
