// apps/driver-app/test/assignments-client.test.ts
// TDD RED: AssignmentsClient fetches GET /transport-orders/assigned with bearer token.
import { describe, it, expect, vi } from 'vitest';
import { AssignmentsClient } from '../src/assignments/assignments-client.js';

describe('AssignmentsClient', () => {
  it('GETs /transport-orders/assigned with bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r1', state: 'dispatched', plate: '62H-12345', orderRef: 'XT.001', customerName: 'ABC', pickupName: 'Kho A', deliveryName: 'Kho B', plannedStartAt: '2026-05-10T08:00:00Z', startedAt: null, completedAt: null }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't0k', fetchFn: fetchFn as never });
    const result = await client.list();
    expect(fetchFn).toHaveBeenCalledWith('http://api/transport-orders/assigned', expect.objectContaining({
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
    await expect(client.list()).rejects.toThrow(/not an object/);
  });

  it('rejects when a row is not an object', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: ['not-obj'] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/not an object/);
  });

  it('rejects when roadRunId is not a string', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [{ roadRunId: 1 }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/roadRunId/);
  });

  it('rejects when state is not a string', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 1 }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/state/);
  });

  it('rejects when nullable field is wrong type', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plate: 123, plannedStartAt: null, startedAt: null, completedAt: null }] }) });
    const { AssignmentsClient } = await import('../src/assignments/assignments-client.js');
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/plate/);
  });
});

describe('AssignmentsClient mutation-hardening', () => {
  it('rejects when row is null (kills L25 raw === null -> false mutant on the second clause)', async () => {
    // typeof null === "object" so the first clause (typeof !== "object") is false.
    // Original: false || (null === null) = true → throws "AssignmentRow: not an object".
    // Mutated `|| false`: false || false = false → no throw, then r['roadRunId'] on null → TypeError.
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [null] }) });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/AssignmentRow: not an object/);
  });

  it('rejects when row is a primitive (kills L25 typeof !== object || === null -> false mutant)', async () => {
    // Original throws "AssignmentRow: not an object" because typeof 42 !== 'object'.
    // Mutated to `typeof raw !== 'object' || false`: typeof 42 !== 'object' is true → still throws.
    // Mutated to `false || raw === null`: 42 === null is false → does NOT throw on L25, continues
    // and fails later at r['roadRunId'] check. So error message must specifically mention 'not an object'.
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: [42] }) });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/AssignmentRow: not an object/);
  });

  it('returns row.state field with its original value (kills L36 r[state] -> r[""] mutant)', async () => {
    // Mutated: state = r[""] = undefined. Original: state = 'dispatched'.
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{
        roadRunId: 'r1', state: 'dispatched',
        plannedStartAt: null, startedAt: null, completedAt: null,
        plate: null, orderRef: null, customerName: null, pickupName: null, deliveryName: null,
      }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    const r = await client.list();
    expect(r[0]?.state).toBe('dispatched');
  });

  it('nullableStr error message names the field "plannedStartAt"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plannedStartAt: 99 }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/plannedStartAt must be string\|null/);
  });

  it('nullableStr error message names the field "startedAt"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plannedStartAt: null, startedAt: 99 }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/startedAt must be string\|null/);
  });

  it('nullableStr error message names the field "completedAt"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plannedStartAt: null, startedAt: null, completedAt: 99 }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/completedAt must be string\|null/);
  });

  it('nullableStr error message names the field "orderRef"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plannedStartAt: null, startedAt: null, completedAt: null, plate: null, orderRef: 99 }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/orderRef must be string\|null/);
  });

  it('nullableStr error message names the field "customerName"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plannedStartAt: null, startedAt: null, completedAt: null, plate: null, orderRef: null, customerName: 99 }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/customerName must be string\|null/);
  });

  it('nullableStr error message names the field "pickupName"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plannedStartAt: null, startedAt: null, completedAt: null, plate: null, orderRef: null, customerName: null, pickupName: 99 }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/pickupName must be string\|null/);
  });

  it('nullableStr error message names the field "deliveryName"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [{ roadRunId: 'r', state: 's', plannedStartAt: null, startedAt: null, completedAt: null, plate: null, orderRef: null, customerName: null, pickupName: null, deliveryName: 99 }] }),
    });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/deliveryName must be string\|null/);
  });

  it('rejects when response body is a string primitive (kills L62 typeof !== object mutant left-side)', async () => {
    // Original: typeof 'str' !== 'object' is true → throws "Response: not an object".
    // Mutated (false || raw === null): 'str' === null is false → does NOT throw on L62,
    // continues to `(raw as { rows? }).rows` which is undefined → throws "rows must be array".
    // So error message must specifically mention "not an object".
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve('a-string-not-object') });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/Response: not an object/);
  });

  it('rejects when rows is not an array with specific error message (kills L64 conditional + string-literal mutants)', async () => {
    // L64: if (!Array.isArray(rows)) throw new Error('Response: rows must be array')
    // Mutated `if (false)` → skips throw, falls through to .map() on non-array → throws different error.
    // Mutated string -> '' → throws empty-message Error. So assert specific message.
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rows: 'not-array' }) });
    const client = new AssignmentsClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.list()).rejects.toThrow(/Response: rows must be array/);
  });
});
