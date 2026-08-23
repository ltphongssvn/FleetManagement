// apps/owner-app/test/adoption-client.test.ts
// RED: fetchAdoptionMetrics - calls GET /owner/metrics/adoption with a bearer
// token and validates the response against the OwnerAdoptionMetricsSchema SSOT.
// fetch + token are injected so this is a pure, deterministic unit.
import { describe, it, expect, vi } from 'vitest';
import { fetchAdoptionMetrics } from '../src/dashboard/adoption-client.js';

const valid = {
  totalDrivers: 5,
  deviceRegistered: 4,
  appInstalled: 3,
  activeToday: 2,
  notInstalled: 2,
  asOf: '2026-07-06T08:00:00.000Z',
  day: '2026-07-06',
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('fetchAdoptionMetrics', () => {
  it('calls the adoption endpoint with a bearer token and returns parsed metrics', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(valid));
    const res = await fetchAdoptionMetrics({
      apiUrl: 'https://api.example.com',
      bearerToken: () => 'tok-123',
      fetchFn,
    });
    expect(res).toEqual(valid);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/owner/metrics/adoption');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
  });

  it('awaits an async bearer token provider', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(valid));
    await fetchAdoptionMetrics({
      apiUrl: 'https://api.example.com',
      bearerToken: () => Promise.resolve('async-tok'),
      fetchFn,
    });
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer async-tok');
  });

  it('throws on a non-ok HTTP response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 403));
    await expect(
      fetchAdoptionMetrics({
        apiUrl: 'https://api.example.com',
        bearerToken: () => 'tok',
        fetchFn,
      }),
    ).rejects.toThrow(/403/);
  });

  it('throws when the response shape does not match the SSOT', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ totalDrivers: 'five' }));
    await expect(
      fetchAdoptionMetrics({
        apiUrl: 'https://api.example.com',
        bearerToken: () => 'tok',
        fetchFn,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  it('rejects a negative count from the server (SSOT guard)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ...valid, appInstalled: -1 }));
    await expect(
      fetchAdoptionMetrics({
        apiUrl: 'https://api.example.com',
        bearerToken: () => 'tok',
        fetchFn,
      }),
    ).rejects.toThrow(/invalid/i);
  });

  it('falls back to globalThis.fetch when no fetchFn is injected', async () => {
    const original = globalThis.fetch;
    const stub = vi.fn().mockResolvedValue(jsonResponse(valid));
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;
    try {
      const res = await fetchAdoptionMetrics({
        apiUrl: 'https://api.example.com',
        bearerToken: () => 'tok',
      });
      expect(res).toEqual(valid);
      expect(stub).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
    }
  });
});
