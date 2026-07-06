// apps/ops-web/test/reference-admin-client-conflict.test.ts
// T5b + problem-details migration: ReferenceAdminClient must surface the
// server''s localized message from EITHER error wire shape:
//   - RFC 9457 envelope (current api, ProblemDetailsExceptionFilter):
//       { title: ''Conflict'', status: 409, detail: ''Khách hàng "X" đã tồn tại'' }
//   - legacy Nest shape (pre-migration compat):
//       { statusCode: 409, message: ''Khách hàng "X" đã tồn tại'', error: ''Conflict'' }
// Consumption is loose per RFC 9457 must-ignore; detail is the human-readable
// member and is used for DISPLAY only (machine branching stays on the code
// extension). When neither shape yields a message, the client falls back to
// status-class Vietnamese via vnApiErrorMessage -- the manufactured
// ''METHOD path HTTP <status>'' string class is ELIMINATED (that exact text is
// what the T5b e2e caught rendering after the api migrated wire shapes; the
// old /HTTP 500/ pin in this file is replaced as an explicit contract change).
import { describe, it, expect, vi } from 'vitest';
import { ReferenceAdminClient } from '@/features/admin/reference-admin-client';

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function problemRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/problem+json' } });
}

describe('ReferenceAdminClient — conflict + error-shape surfacing', () => {
  it('create() surfaces detail from the RFC 9457 envelope (current api wire shape)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(problemRes({
      title: 'Conflict',
      status: 409,
      detail: 'Khách hàng "ĐÀ NẴNG" đã tồn tại',
    }, 409)));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.create('ĐÀ NẴNG')).rejects.toThrow(/đã tồn tại/);
  });

  it('update() surfaces detail from the RFC 9457 envelope', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(problemRes({
      title: 'Conflict',
      status: 409,
      detail: 'Số xe "62H 05194" đã tồn tại',
    }, 409)));
    const client = new ReferenceAdminClient('vehicles', fetchFn);
    await expect(client.update('v1', '62H 05194')).rejects.toThrow(/đã tồn tại/);
  });

  it('create() still surfaces the legacy Nest message shape (compat)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({
      statusCode: 409,
      message: 'Khách hàng "ĐA NẴNG" đã tồn tại',
      error: 'Conflict',
    }, 409)));
    const client = new ReferenceAdminClient('customers', fetchFn);
    await expect(client.create('ĐA NẴNG')).rejects.toThrow(/đã tồn tại/);
  });

  it('update() still surfaces the legacy Nest message shape (compat)', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({
      statusCode: 409,
      message: 'Số xe "62H 05194" đã tồn tại',
      error: 'Conflict',
    }, 409)));
    const client = new ReferenceAdminClient('vehicles', fetchFn);
    await expect(client.update('v1', '62H 05194')).rejects.toThrow(/đã tồn tại/);
  });

  it('falls back to status-class Vietnamese, never a raw HTTP string, when the body is unreadable', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    const client = new ReferenceAdminClient('customers', fetchFn);
    const err = await client.create('X').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toBe('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.');
    expect(msg.includes('HTTP')).toBe(false);
  });
});
