// apps/driver-app/test/delivery-lifecycle-client.test.ts
// TDD RED: DeliveryLifecycleClient POSTs the driver delivery transitions
// (accept/start/complete) to /driver/assignments/:roadRunId/<action>.
import { describe, it, expect, vi } from 'vitest';
import { DeliveryLifecycleClient } from '../src/assignments/delivery-lifecycle-client.js';

describe('DeliveryLifecycleClient', () => {
  it('accept() POSTs /driver/assignments/:id/accept with bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ roadRunId: 'rr1', state: 'dispatched' }),
    });
    const client = new DeliveryLifecycleClient({
      apiUrl: 'http://api',
      bearerToken: () => 'tok',
      fetchFn: fetchFn as never,
    });
    const result = await client.accept('rr1');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://api/driver/assignments/rr1/accept',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
    expect(result).toEqual({ roadRunId: 'rr1', state: 'dispatched' });
  });

  it('start() POSTs the /start action', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ roadRunId: 'rr2', state: 'started' }),
    });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    const result = await client.start('rr2');
    expect(fetchFn).toHaveBeenCalledWith('http://api/driver/assignments/rr2/start', expect.objectContaining({ method: 'POST' }));
    expect(result.state).toBe('started');
  });

  it('complete() POSTs the /complete action', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ roadRunId: 'rr3', state: 'completed' }),
    });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    const result = await client.complete('rr3');
    expect(fetchFn).toHaveBeenCalledWith('http://api/driver/assignments/rr3/complete', expect.objectContaining({ method: 'POST' }));
    expect(result.state).toBe('completed');
  });

  it('throws on non-ok HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.accept('rr')).rejects.toThrow(/400/);
  });

  it('throws when the response shape is invalid', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ roadRunId: 'rr' }) });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.accept('rr')).rejects.toThrow(/state/);
  });
});
