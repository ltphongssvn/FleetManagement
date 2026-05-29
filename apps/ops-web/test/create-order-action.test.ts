// apps/ops-web/test/create-order-action.test.ts
// L2 RED → GREEN for T3: createOrder server action must
//  - NOT require dispatcher-supplied externalRef (server assigns it),
//  - NOT send any client externalRef on the API body,
//  - surface the server-assigned externalRef back to the form caller as
//    state.status='created' on the success path so the UI can render it
//    (instead of a blind redirect that loses the assigned XTT.MM-NNN).
// All other failure paths (zod, env, cookie, api error) keep their shape.
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
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08T09:00');
    fd.set('pickupWarehouse_1', 'WH-1');
    fd.set('deliveryAt', '2026-05-08T11:00');
    fd.set('deliveryWarehouse_1', 'DEST-1');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'created', externalRef: 'XT.001', transportOrderId: 't1' });
    // T3 follow-up (button state recovery): the action must NOT call
    // revalidatePath('/'), because '/' hosts the form itself plus heavy
    // server data fetching. Per Next.js v15 regression (vercel/next.js#82289)
    // that revalidation keeps the useActionState pending flag true until
    // the entire home page re-renders, stranding the dispatcher on
    // 'Đang tạo…'. The client refreshes targeted state after success.
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
    fd.set('externalRef', 'STALE-VALUE'); // a stale UI value, must be dropped
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08T09:00');
    fd.set('pickupWarehouse_1', 'WH-1');
    fd.set('deliveryAt', '2026-05-08T11:00');
    fd.set('deliveryWarehouse_1', 'DEST-1');
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
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08T09:00');
    fd.set('pickupWarehouse_1', 'WH-1');
    fd.set('deliveryAt', '2026-05-08T11:00');
    fd.set('deliveryWarehouse_1', 'DEST-1');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'api_error', message: expect.stringContaining('400') });
  });
  it('passes plannedAt through unchanged when it already has seconds (else branch)', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ transportOrderId: 't1', roadRunId: 'r1', externalRef: 'XT.003' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', fetchMock);
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08T08:00:00'); // 19 chars, already has seconds
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08T09:00:00');
    fd.set('pickupWarehouse_1', 'WH-1');
    fd.set('deliveryAt', '2026-05-08T11:00:00');
    fd.set('deliveryWarehouse_1', 'DEST-1');
    await createOrder(undefined, fd);
    const calls = fetchMock.mock.calls as unknown as [string, { body: string }][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('no fetch call');
    const body = JSON.parse(firstCall[1].body);
    expect(body.roadRun.plannedStartAt).toBe('2026-05-08T08:00:00.000Z');
  });
  it('returns server_error when FLEET_API_URL is not set', async () => {
    vi.stubEnv('FLEET_API_URL', '');
    cookieGet.mockReturnValue({ value: 'tok' });
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08T09:00');
    fd.set('pickupWarehouse_1', 'WH-1');
    fd.set('deliveryAt', '2026-05-08T11:00');
    fd.set('deliveryWarehouse_1', 'DEST-1');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'server_error', message: expect.stringContaining('FLEET_API_URL') });
  });
  it('returns server_error when fleet_session cookie missing', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValueOnce(undefined as unknown as { value: string });
    const { createOrder } = await import('@/features/dispatch/create-order.action');
    const fd = new FormData();
    fd.set('plannedStartAt', '2026-05-08T08:00');
    fd.set('assignedOperatorId', '00000000-0000-0000-0000-000000000001');
    fd.set('assignedAssetId', '00000000-0000-0000-0000-0000000000a2');
    fd.set('pickupAt', '2026-05-08T09:00');
    fd.set('pickupWarehouse_1', 'WH-1');
    fd.set('deliveryAt', '2026-05-08T11:00');
    fd.set('deliveryWarehouse_1', 'DEST-1');
    const r = await createOrder(undefined, fd);
    expect(r).toEqual({ status: 'server_error', message: 'Not authenticated' });
  });
});
