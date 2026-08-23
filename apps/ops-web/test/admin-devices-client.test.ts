// apps/ops-web/test/admin-devices-client.test.ts
// RED (P7 slice-C): browser client for the devices approval queue. Unlike the
// drivers client (which CASTS res.json() as T -- a recorded Axis-1 gap), this
// client VALIDATES the response through the SSOT AdminDeviceListResponseSchema
// on read: an HTTP response is an untrusted boundary, and the paginated envelope
// has a shared schema, so parsing is free. A malformed/garbage payload must
// surface as a typed failure, never as undefined fields reaching the table.
// Non-ok responses ride the existing ensureOk seam (ApiProblemError).
import { describe, it, expect, vi } from 'vitest';
import { AdminDevicesClient } from '@/features/admin/admin-devices-client';

const GUID = '018f6b2a-1111-7000-8000-000000000001';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PAGE = {
  data: [
    {
      deviceId: GUID,
      operatorId: GUID,
      platform: 'android',
      bindingStatus: 'pending',
      attestationSecurityLevel: 'strongbox',
      attestationEnvironment: 'production',
      attestationVerifiedAt: '2026-07-20T00:00:00.000Z',
      bindingRevokedReason: null,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
  hasMore: false,
};

describe('AdminDevicesClient', () => {
  it('list requests the BFF route with the status filter and page params', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(PAGE));
    const client = new AdminDevicesClient({ fetchFn });
    await client.list({ status: 'pending', page: 2, pageSize: 5 });
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toContain('/api/admin/devices');
    expect(url).toContain('status=pending');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=5');
  });
  it('list returns the parsed envelope on a valid response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(PAGE));
    const client = new AdminDevicesClient({ fetchFn });
    const page = await client.list({ status: 'pending', page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect(page.data[0]?.bindingStatus).toBe('pending');
  });
  it('list THROWS on a malformed envelope instead of leaking garbage to the table', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes({ data: [{ deviceId: 'not-a-guid' }] }));
    const client = new AdminDevicesClient({ fetchFn });
    await expect(client.list({ status: 'pending', page: 1, pageSize: 20 })).rejects.toThrow();
  });
  it('list raises non-ok responses through the ensureOk problem seam', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(problem, 401));
    const client = new AdminDevicesClient({ fetchFn });
    await expect(client.list({ status: 'pending', page: 1, pageSize: 20 })).rejects.toThrow();
  });
  it('activate PATCHes the binding route with the activate action', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes({ ok: true }));
    const client = new AdminDevicesClient({ fetchFn });
    await client.activate(GUID);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/devices/' + GUID + '/binding');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'activate' });
  });
  it('revoke PATCHes with the reason recorded for the audit trail', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes({ ok: true }));
    const client = new AdminDevicesClient({ fetchFn });
    await client.revoke(GUID, 'thiet bi bi mat');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'revoke',
      revokedReason: 'thiet bi bi mat',
    });
  });
});
