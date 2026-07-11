// workers/main-worker/test/intake-callback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FetchIntakeCallback } from '../src/intake/intake-callback.js';
describe('@fleet/main-worker - FetchIntakeCallback', () => {
  it('POSTs to /upload/intake-result with bearer token, POST method and JSON content-type on accepted', async () => {
    const captured: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {};
    const fetchFn = vi.fn().mockImplementation(
      (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
        captured.url = url;
        captured.method = init.method;
        captured.headers = init.headers;
        captured.body = init.body;
        return Promise.resolve({ ok: true });
      },
    );
    const cb = new FetchIntakeCallback({ apiUrl: 'http://api', bearerToken: () => 'tok-1', fetchFn: fetchFn as never });
    await cb.finalize({ uploadSessionId: 'us-1', accepted: true });
    expect(captured.url).toBe('http://api/upload/intake-result');
    expect(captured.method).toBe('POST');
    expect(captured.headers?.['Content-Type']).toBe('application/json');
    expect(captured.headers?.['Authorization']).toBe('Bearer tok-1');
    expect(captured.body).toContain('"accepted":true');
  });
  it('forwards rejectionReasonCode in body when provided', async () => {
    let body: string | undefined;
    const fetchFn = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      body = init.body;
      return Promise.resolve({ ok: true });
    });
    const cb = new FetchIntakeCallback({ apiUrl: 'http://api', bearerToken: () => Promise.resolve('tok-2'), fetchFn: fetchFn as never });
    await cb.finalize({ uploadSessionId: 'us-2', accepted: false, rejectionReasonCode: 'virus_detected' });
    expect(body).toContain('virus_detected');
  });
  it('throws on non-2xx so BullMQ retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'unavail' });
    const cb = new FetchIntakeCallback({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never });
    await expect(cb.finalize({ uploadSessionId: 'us-3', accepted: true })).rejects.toThrow(/HTTP 503/);
  });
  it('invokes onUnauthorized exactly once on 401, then still throws (BullMQ outer retry)', async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const cb = new FetchIntakeCallback({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never, onUnauthorized });
    await expect(cb.finalize({ uploadSessionId: 'us-5', accepted: true })).rejects.toThrow(/HTTP 401/);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
  it('does NOT invoke onUnauthorized on other non-2xx statuses', async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'unavail' });
    const cb = new FetchIntakeCallback({ apiUrl: 'http://api', bearerToken: () => 't', fetchFn: fetchFn as never, onUnauthorized });
    await expect(cb.finalize({ uploadSessionId: 'us-6', accepted: true })).rejects.toThrow(/HTTP 503/);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('falls back to globalThis.fetch when fetchFn omitted', async () => {
    const origFetch = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = spy as never;
    try {
      const cb = new FetchIntakeCallback({ apiUrl: 'http://api', bearerToken: () => 't' });
      await cb.finalize({ uploadSessionId: 'us-4', accepted: true });
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
