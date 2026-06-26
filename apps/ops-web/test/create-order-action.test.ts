// apps/ops-web/test/create-order-action.test.ts
// L2 RED → GREEN for T3: createOrder server action must
//  - NOT require dispatcher-supplied externalRef (server assigns it),
//  - NOT send any client externalRef on the API body,
//  - surface the server-assigned externalRef back to the form caller as
//    state.status='created' on the success path so the UI can render it
//    (instead of a blind redirect that loses the assigned XTT.MM-NNN).
// All other failure paths (zod, env, cookie, api error) keep their shape.
//
// T8 (2026): date-only contract. The three calendar inputs (plannedStartAt /
// pickupAt / deliveryAt) are YYYY-MM-DD per z.iso.date(). The action
// promotes each to UTC midnight ISO datetime before forwarding to the api,
// so the api wire contract is unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
describe('createOrder server action (T3 auto-numbering)', () => {
  beforeEach(() => {
    cookieGet.mockReset();
    revalidatePath.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('accepts a submission without externalRef (server assigns Số Lệnh)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt-abc' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XT.001' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08');
    fd.set('pickupWarehouse_1', '99999999-0001-4000-8000-000000000001');
    fd.set('deliveryAt', '2026-05-08');
    fd.set('deliveryWarehouse_1', '99999999-0002-4000-8000-000000000001');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'created', externalRef: 'XT.001', transportOrderId: 't1' });
    expect(revalidatePath).not.toHaveBeenCalledWith('/');
  });
  it('does not send externalRef in the API body even if a stale form value is present', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'jwt-abc' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XT.002' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('externalRef', 'STALE-VALUE');
    fd.set('plannedStartAt', '2026-05-08');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08');
    fd.set('pickupWarehouse_1', '99999999-0001-4000-8000-000000000001');
    fd.set('deliveryAt', '2026-05-08');
    fd.set('deliveryWarehouse_1', '99999999-0002-4000-8000-000000000001');
    await createOrder(undefined, fd);
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body);
    expect(body.externalRef).toBeUndefined();
  });
  it('returns api_error when api fails', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: 'bad' }), { status: 400 }))));
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08');
    fd.set('pickupWarehouse_1', '99999999-0001-4000-8000-000000000001');
    fd.set('deliveryAt', '2026-05-08');
    fd.set('deliveryWarehouse_1', '99999999-0002-4000-8000-000000000001');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'api_error', message: expect.stringContaining('400') });
  });
  it('promotes date-only plannedStartAt to UTC midnight ISO (T8 date-only contract)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XT.003' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08');
    fd.set('pickupWarehouse_1', '99999999-0001-4000-8000-000000000001');
    fd.set('deliveryAt', '2026-05-08');
    fd.set('deliveryWarehouse_1', '99999999-0002-4000-8000-000000000001');
    await createOrder(undefined, fd);
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body);
    expect(body.roadRun.plannedStartAt).toBe('2026-05-08T00:00:00.000Z');
  });
  it('returns server_error when FLEET_API_URL is not set', async () => {
    vi.stubEnv('FLEET_API_URL', '');
    cookieGet.mockReturnValue({ value: 'tok' });
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08');
    fd.set('pickupWarehouse_1', '99999999-0001-4000-8000-000000000001');
    fd.set('deliveryAt', '2026-05-08');
    fd.set('deliveryWarehouse_1', '99999999-0002-4000-8000-000000000001');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'server_error', message: expect.stringContaining('FLEET_API_URL') });
  });
  it('returns server_error when fleet_session cookie missing', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValueOnce(undefined as unknown as { value: string });
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08');
    fd.set('pickupWarehouse_1', '99999999-0001-4000-8000-000000000001');
    fd.set('deliveryAt', '2026-05-08');
    fd.set('deliveryWarehouse_1', '99999999-0002-4000-8000-000000000001');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'server_error', message: 'Not authenticated' });
  });
});
