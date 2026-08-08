// apps/driver-app/test/assignments-client.test.ts
// AssignmentsClient wire behaviour: URL, auth header, and rejection of a
// response that does not satisfy the contract.
//
// A whole 'mutation-hardening' describe was REMOVED here. Every test in it
// asserted the internals of parseStop/parseRow/parseMonth -- error strings like
// 'plannedStartAt must be string|null' and comments naming the mutant on a
// specific source line. Those functions no longer exist: both reads now parse
// through the shared contract, so Zod owns that validation and the assertions
// described code that is gone. Tests coupled to an implementation cannot
// survive replacing it, and keeping them green would have meant keeping the
// duplicate parser alive to satisfy them.
//
// What they GUARDED is retained: a malformed row and a malformed envelope are
// still asserted to reject, expressed against the contract rather than against
// a deleted error message.
import { describe, it, expect, vi } from 'vitest';
import { createListAssignedRow } from '@fleet/test-fixtures';
import { AssignmentsClient } from '../src/assignments/assignments-client.js';
import { DriverCompletedPageResponseSchema } from '@fleet/sync-protocol';

// Built THROUGH ListAssignedRowSchema, so a fixture cannot drift from the wire
// contract the way the old hand-written literals did (they omitted six fields).
const ROW = createListAssignedRow({
  transportOrderId: 'to-1',
  roadRunId: 'r1',
  state: 'dispatched',
  plate: '62H-12345',
  orderRef: 'XT.001',
  customerName: 'ABC',
  pickupName: 'Kho A',
  deliveryName: 'Kho B',
  plannedStartAt: '2026-05-10T08:00:00Z',
  startedAt: null,
  completedAt: null,
});

describe('AssignmentsClient', () => {
  it('GETs /transport-orders/assigned with bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [ROW] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't0k', fetchFn: fetchFn as never });
    const result = await client.list();
    expect(fetchFn).toHaveBeenCalledWith('http://api/transport-orders/assigned', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer t0k' }),
    }));
    expect(result).toHaveLength(1);
    expect(result[0]?.transportOrderId).toBe('to-1');
    expect(result[0]?.roadRunId).toBe('r1');
    expect(result[0]?.plate).toBe('62H-12345');
    expect(result[0]?.orderRef).toBe('XT.001');
    expect(result[0]?.customerName).toBe('ABC');
    expect(result[0]?.pickupName).toBe('Kho A');
    expect(result[0]?.deliveryName).toBe('Kho B');
  });

  it('throws on non-ok HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/401/);
  });

  it('rejects malformed response shape', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: 'not-an-array' }) });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow();
  });

  it('awaits async bearerToken provider', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [] }) });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => Promise.resolve('async-tok'), fetchFn: fetchFn as never });
    await client.list();
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer async-tok' }),
    }));
  });

  it('uses global fetch when fetchFn not provided', async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [] }) });
    globalThis.fetch = spy as never;
    try {
      const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
      const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't' });
      await client.list();
      expect(spy).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects when response is not an object', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow();
  });

  it('rejects when a row is not an object', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: ['not-obj'] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow();
  });

  it('rejects when roadRunId is not a string', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [{ transportOrderId: 'to', roadRunId: 1 }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow();
  });

  it('rejects when state is not a string', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [{ transportOrderId: 'to', roadRunId: 'r', state: 1 }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow();
  });

  it('rejects when nullable field is wrong type', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [{ transportOrderId: 'to', roadRunId: 'r', state: 's', plate: 123, plannedStartAt: null, startedAt: null, completedAt: null }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow();
  });
});

describe('AssignmentsClient.completed', () => {
  const okEnvelope = (over: Record<string, unknown>): { ok: true; json: () => Promise<unknown> } => ({
    ok: true,
    json: () => Promise.resolve({
      data: [{ transportOrderId: 'to-1', externalRef: 'XTT.06-008', roadRunId: 'rr-1', state: 'completed', plannedStartAt: null, createdAt: '2026-06-10T01:00:00.000Z', startedAt: null, completedAt: '2026-06-12T09:30:00.000Z', orderRef: 'XTT.06-008', plate: '62H 06209', customerName: 'ĐẠI THÀNH', cargoName: null, driverName: null, pickupName: null, deliveryName: null, stops: [] }],
      page: 1, pageSize: 20, total: 1, totalPages: 1, hasMore: false,
      ...over,
    }),
  });

  it('GETs /transport-orders/completed with page + pageSize query and bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okEnvelope({}));
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't0k', fetchFn: fetchFn as never });
    const page = await client.completed({ page: 1, pageSize: 20 });
    expect(fetchFn).toHaveBeenCalledWith('http://api/transport-orders/completed?page=1&pageSize=20', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer t0k' }),
    }));
    expect(page.total).toBe(1);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.state).toBe('completed');
    expect(page.hasMore).toBe(false);
  });

  it('serializes an optional search term into the query string', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okEnvelope({}));
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await client.completed({ page: 2, pageSize: 10, search: 'XTT.06' });
    const calledUrl = fetchFn.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/transport-orders/completed?');
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('pageSize=10');
    expect(calledUrl).toContain('search=XTT.06');
  });

  it('parses the envelope through the SSOT schema and returns typed rows', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okEnvelope({}));
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    const page = await client.completed({ page: 1, pageSize: 20 });
    // the returned shape validates against the contract
    expect(() => DriverCompletedPageResponseSchema.parse(page)).not.toThrow();
    expect(page.data[0]?.customerName).toBe('ĐẠI THÀNH');
  });

  it('throws on a non-ok HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.completed({ page: 1, pageSize: 20 })).rejects.toThrow(/401/);
  });

  it('rejects a malformed envelope (missing hasMore) via the schema', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ transportOrderId: 'to-1', externalRef: 'XTT.06-008', roadRunId: 'rr-1', state: 'completed', plannedStartAt: null, createdAt: '2026-06-10T01:00:00.000Z', startedAt: null, completedAt: '2026-06-12T09:30:00.000Z', orderRef: 'XTT.06-008', plate: '62H 06209', customerName: 'ĐẠI THÀNH', cargoName: null, driverName: null, pickupName: null, deliveryName: null, stops: [] }], page: 1, pageSize: 20, total: 1, totalPages: 1 }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.completed({ page: 1, pageSize: 20 })).rejects.toThrow();
  });
});
