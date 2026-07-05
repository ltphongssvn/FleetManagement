// apps/driver-app/test/delivery-lifecycle-client.test.ts
// TDD RED: DeliveryLifecycleClient POSTs the driver delivery transitions
// (accept/start/complete) to /driver/assignments/:roadRunId/<action>.
import { describe, it, expect, vi } from 'vitest';
import { DeliveryLifecycleClient } from '../src/assignments/delivery-lifecycle-client.js';
import { ApiError } from '../src/errors/api-error.js';

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

  it('throws ApiError carrying the parsed envelope on non-ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({
        title: 'Conflict',
        status: 409,
        detail: 'Cannot complete a run that has not been started.',
        code: 'INVALID_STATE_TRANSITION',
      }),
    });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    let caught: unknown = null;
    try {
      await client.complete('rr');
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof ApiError).toBe(true);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(409);
    expect(apiErr.code).toBe('INVALID_STATE_TRANSITION');
    expect(apiErr.message).toBe('Cannot complete a run that has not been started.');
    expect(apiErr.message.includes('http')).toBe(false);
  });
  it('throws a URL-free ApiError when the error body is not an envelope', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Bad Request', statusCode: 400 }),
    });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    let caught: unknown = null;
    try {
      await client.accept('rr');
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof ApiError).toBe(true);
    const apiErr = caught as ApiError;
    expect(apiErr.problem).toBeNull();
    expect(apiErr.message).toBe('HTTP 400');
    expect(apiErr.message.includes('http://api')).toBe(false);
  });
  it('throws a URL-free ApiError even when the error body cannot be read', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('invalid json')),
    });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    let caught: unknown = null;
    try {
      await client.start('rr');
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof ApiError).toBe(true);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(502);
    expect(apiErr.problem).toBeNull();
    expect(apiErr.message).toBe('HTTP 502');
  });

  it('throws when the response body is not an object', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve('nope') });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.accept('rr')).rejects.toThrow(/not an object/);
  });
  it('throws when roadRunId is missing from the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ state: 'dispatched' }) });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.accept('rr')).rejects.toThrow(/roadRunId/);
  });
  it('throws when the response shape is invalid', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ roadRunId: 'rr' }) });
    const client = new DeliveryLifecycleClient({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(client.accept('rr')).rejects.toThrow(/state/);
  });
});
