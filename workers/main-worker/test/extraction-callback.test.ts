// workers/main-worker/test/extraction-callback.test.ts
// Coverage gate (mirrors intake-callback.test.ts): FetchExtractionCallback
// posts the SSOT-validated body with bearer auth; throws on non-2xx so BullMQ
// retries; rejects schema-invalid inputs BEFORE any network call.
import { describe, expect, it, vi } from 'vitest';
import { FetchExtractionCallback } from '../src/extraction/extraction-callback.js';

const RESULT = { manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d', status: 'extracted' as const, extractedNetWeightKg: 20730 };

describe('FetchExtractionCallback', () => {
  it('POSTs the SSOT body to /upload/extraction-result with bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const cb = new FetchExtractionCallback({ apiUrl: 'http://api:3000', bearerToken: () => 'tok-1', fetchFn });
    await cb.finalize(RESULT);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api:3000/upload/extraction-result');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-1');
    expect(JSON.parse(init.body as string)).toEqual(RESULT);
  });

  it('supports async bearerToken providers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const cb = new FetchExtractionCallback({ apiUrl: 'http://api:3000', bearerToken: () => Promise.resolve('tok-async'), fetchFn });
    await cb.finalize({ ...RESULT, status: 'not_found', extractedNetWeightKg: null });
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-async');
  });

  it('throws on non-2xx so BullMQ retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('x', { status: 503, statusText: 'Service Unavailable' }));
    const cb = new FetchExtractionCallback({ apiUrl: 'http://api:3000', bearerToken: () => 'tok', fetchFn });
    await expect(cb.finalize(RESULT)).rejects.toThrow('extraction-result HTTP 503');
  });

  it('rejects invariant-violating bodies before any network call', async () => {
    const fetchFn = vi.fn();
    const cb = new FetchExtractionCallback({ apiUrl: 'http://api:3000', bearerToken: () => 'tok', fetchFn });
    await expect(cb.finalize({ ...RESULT, extractedNetWeightKg: null } as never)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses globalThis.fetch when no fetchFn injected (default path)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const cb = new FetchExtractionCallback({ apiUrl: 'http://api:3000', bearerToken: () => 'tok' });
    await cb.finalize(RESULT);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
