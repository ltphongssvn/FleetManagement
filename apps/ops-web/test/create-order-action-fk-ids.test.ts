// apps/ops-web/test/create-order-action-fk-ids.test.ts
// T7 L2 RED → GREEN: the createOrder server action must forward FK ids
// (customerId, cargoTypeId, per-stop yardId) on the API body so the
// projection/review enrichment joins succeed. Free-text labels in
// metadata break referential integrity and prevent any read-side
// enrichment (industry 2026 CQRS norm: write-side persists FK,
// read-side joins them once at projection time).
//
// T8 (2026): date-only contract — plannedStartAt / pickupAt / deliveryAt are
// YYYY-MM-DD per z.iso.date().
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const CARGO_ID = '22222222-2222-4222-8222-222222222222';
const PICKUP_WH_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERY_WH_ID = '44444444-4444-4444-8444-444444444444';
const DRIVER_OP_ID = '00000000-0000-0000-0000-000000000001';
const VEHICLE_ID = '00000000-0000-0000-0000-0000000000a2';
function buildFormData(): FormData {
  const fd = new FormData();
  fd.set('plannedStartAt', '2026-06-02');
  fd.set('assignedOperatorId', DRIVER_OP_ID);
  fd.set('assignedAssetId', VEHICLE_ID);
  fd.set('customer', CUSTOMER_ID);
  fd.set('cargo', CARGO_ID);
  fd.set('pickupAt', '2026-06-02');
  fd.set('pickupWarehouse_1', PICKUP_WH_ID);
  fd.set('deliveryAt', '2026-06-02');
  fd.set('deliveryWarehouse_1', DELIVERY_WH_ID);
  return fd;
}
describe('createOrder server action forwards FK ids (T7)', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('sends customerId at the API body root when form customer is a UUID', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XTT.06-001' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    await createOrder(undefined, buildFormData());
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body);
    expect(body.customerId).toBe(CUSTOMER_ID);
  });
  it('sends cargoTypeId at the API body root when form cargo is a UUID', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XTT.06-001' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    await createOrder(undefined, buildFormData());
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body);
    expect(body.cargoTypeId).toBe(CARGO_ID);
  });
  it('sends each stop with yardId set to the warehouse UUID', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XTT.06-001' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    await createOrder(undefined, buildFormData());
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body) as { stops: { stopType: string; yardId?: string }[] };
    const pickup = body.stops.find((s) => s.stopType === 'pickup');
    const delivery = body.stops.find((s) => s.stopType === 'delivery');
    expect(pickup?.yardId).toBe(PICKUP_WH_ID);
    expect(delivery?.yardId).toBe(DELIVERY_WH_ID);
  });
});
