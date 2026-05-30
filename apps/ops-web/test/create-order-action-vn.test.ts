// apps/ops-web/test/create-order-action-vn.test.ts
// T7 (2026): the create-order action forwards FK ids for customer / cargo /
// warehouse references, not free-text Vietnamese labels. Vietnamese plates
// and driver names still surface verbatim through the display-only metadata
// (those fields have no FK in the schema). Industry 2026 CQRS norm: write
// side persists normalized FKs; the read side joins them once to render the
// Vietnamese labels back to the dispatcher.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const CARGO_ID = '22222222-2222-4222-8222-222222222222';
const PICKUP_WH_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERY_WH_ID = '44444444-4444-4444-8444-444444444444';
describe('createOrder VN fields', () => {
  beforeEach(() => { cookieGet.mockReset(); vi.unstubAllGlobals(); vi.resetModules(); });
  it('forwards FK ids at the body root and keeps VN plate/driver in metadata', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XTT.04-001' }), { status: 201 })));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-04-10T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('deliveryAt', '2026-04-10T11:00');
    fd.set('customer', CUSTOMER_ID);
    fd.set('cargo', CARGO_ID);
    fd.set('vehiclePlate', '62H 05817');
    fd.set('driverName', 'LÊ VĂN CHÂU');
    fd.set('pickupAt', '2026-04-10T09:00');
    fd.set('pickupWarehouse_1', PICKUP_WH_ID);
    fd.set('deliveryWarehouse_1', DELIVERY_WH_ID);
    await createOrder(undefined, fd);
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body) as Record<string, unknown> & {
      stops: { stopType: string; yardId?: string }[];
      metadata: Record<string, unknown>;
    };
    expect(body['customerId']).toBe(CUSTOMER_ID);
    expect(body['cargoTypeId']).toBe(CARGO_ID);
    const pickup = body.stops.find((s) => s.stopType === 'pickup');
    const delivery = body.stops.find((s) => s.stopType === 'delivery');
    expect(pickup?.yardId).toBe(PICKUP_WH_ID);
    expect(delivery?.yardId).toBe(DELIVERY_WH_ID);
    expect(body.metadata).toEqual({
      vehiclePlate: '62H 05817',
      driverName: 'LÊ VĂN CHÂU',
    });
  });
});
