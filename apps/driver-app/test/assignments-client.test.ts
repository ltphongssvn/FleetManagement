// apps/driver-app/test/assignments-client.test.ts
// TDD RED: AssignmentsClient fetches GET /driver/assignments with bearer token.
import { describe, it, expect, vi } from 'vitest';
import { AssignmentsClient } from '../src/assignments/assignments-client.js';

describe('AssignmentsClient', () => {
  it('GETs /driver/assignments with bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [{ roadRunId: 'r1', state: 'dispatched', plate: '62H-12345', orderRef: 'XT.001', customerName: 'ABC', pickupName: 'Kho A', deliveryName: 'Kho B', plannedStartAt: '2026-05-10T08:00:00Z', startedAt: null, completedAt: null }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't0k', fetchFn: fetchFn as never });
    const result = await client.list();
    expect(fetchFn).toHaveBeenCalledWith('http://api/driver/assignments', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer t0k' }),
    }));
    expect(result).toHaveLength(1);
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
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: 'not-an-array' }) });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow();
  });

  it('awaits async bearerToken provider', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: async () => 'async-tok', fetchFn: fetchFn as never });
    await client.list();
    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer async-tok' }),
    }));
  });

  it('uses global fetch when fetchFn not provided', async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
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
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/not an object/);
  });

  it('rejects when a row is not an object', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: ['not-obj'] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/not an object/);
  });

  it('rejects when roadRunId is not a string', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [{ roadRunId: 1 }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/roadRunId/);
  });

  it('rejects when state is not a string', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [{ roadRunId: 'r', state: 1 }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/state/);
  });

  it('rejects when nullable field is wrong type', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [{ roadRunId: 'r', state: 's', plate: 123, plannedStartAt: null, startedAt: null, completedAt: null }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/plate/);
  });
});
