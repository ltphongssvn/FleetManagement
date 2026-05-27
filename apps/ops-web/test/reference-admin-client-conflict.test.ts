// apps/ops-web/test/reference-admin-client-conflict.test.ts
// T5b RED: ReferenceAdminClient.create() must surface the server's
// localized 409 message (Nest ConflictException body) instead of a
// generic 'HTTP 409' string. Nest renders ConflictException as JSON:
//   { statusCode: 409, message: 'Khách hàng "X" đã tồn tại', error: 'Conflict' }
// The client must extract .message so the page can render it.
import { describe, it, expect, vi } from 'vitest';
import { ReferenceAdminClient } from '@/features/admin/reference-admin-client';
function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
describe('ReferenceAdminClient — 409 conflict surfacing', () => {
  it('create() throws with the server-provided localized message on HTTP 409', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({
      statusCode: 409,
      message: 'Khách hàng "ĐA NẴNG" đã tồn tại',
      error: 'Conflict',
    }, 409)));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.create('ĐA NẴNG')).rejects.toThrow(/đã tồn tại/);
  });
  it('update() throws with the server-provided localized message on HTTP 409', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({
      statusCode: 409,
      message: 'Số xe "62H 05194" đã tồn tại',
      error: 'Conflict',
    }, 409)));
    const client = new ReferenceAdminClient('vehicles', fetchFn);
    await expect(client.update('v1', '62H 05194')).rejects.toThrow(/đã tồn tại/);
  });
  it('create() falls back to a generic HTTP message when no JSON body is returned', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.create('X')).rejects.toThrow(/HTTP 500/);
  });
});
