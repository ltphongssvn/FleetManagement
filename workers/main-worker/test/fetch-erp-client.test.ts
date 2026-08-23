// workers/main-worker/test/fetch-erp-client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchErpClient } from '../src/erp/fetch-erp-client.js';
import type { MappedErpPayload } from '../src/erp/erp-policy.js';
const payload: MappedErpPayload = {
  manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
  transportOrderId: '22222222-2222-7222-8222-222222222222',
  customerExternalId: 'CUST-1',
  jobCodeExternalId: 'JOB-EXT-1',
  amountCents: 5000,
  currency: 'USD',
  erpSystem: 'sap',
};
describe('@fleet/main-worker - FetchErpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('returns externalInvoiceId on 2xx and sends JSON content-type + API key headers', async () => {
    const captured: { url?: string; init?: { method?: string; headers?: Record<string, string> } } =
      {};
    const fetchFn = vi
      .fn()
      .mockImplementation(
        (url: string, init: { method?: string; headers?: Record<string, string> }) => {
          captured.url = url;
          captured.init = init;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ externalInvoiceId: 'EXT-42' }),
          });
        },
      );
    const client = new FetchErpClient({
      baseUrl: 'http://erp',
      apiKey: 'k',
      fetchFn: fetchFn as never,
    });
    const res = await client.sendInvoice(payload);
    expect(res.externalInvoiceId).toBe('EXT-42');
    expect(captured.url).toBe('http://erp/invoices');
    expect(captured.init?.method).toBe('POST');
    expect(captured.init?.headers?.['Content-Type']).toBe('application/json');
    expect(captured.init?.headers?.['X-API-Key']).toBe('k');
  });
  it('throws on non-2xx and includes the error body detail in the message', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'err',
      text: () => Promise.resolve('boom'),
    });
    const client = new FetchErpClient({
      baseUrl: 'http://erp',
      apiKey: 'k',
      fetchFn: fetchFn as never,
    });
    await expect(client.sendInvoice(payload)).rejects.toThrow(/ERP \/invoices HTTP 500 err boom/);
  });
  it('throws when response missing externalInvoiceId', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ wrong: 'x' }),
    });
    const client = new FetchErpClient({
      baseUrl: 'http://erp',
      apiKey: 'k',
      fetchFn: fetchFn as never,
    });
    await expect(client.sendInvoice(payload)).rejects.toThrow(/externalInvoiceId/);
  });
  it('uses empty-string detail when error body is unreadable (no injected text, no "undefined")', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'bad',
      text: () => Promise.reject(new Error('stream err')),
    });
    const client = new FetchErpClient({
      baseUrl: 'http://erp',
      apiKey: 'k',
      fetchFn: fetchFn as never,
    });
    let caught: unknown;
    try {
      await client.sendInvoice(payload);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // detail falls back to '': message is exactly the prefix + trailing space.
    expect(message).toBe('ERP /invoices HTTP 502 bad ');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('Stryker');
  });
  it('falls back to globalThis.fetch when no fetchFn is configured (covers ?? branch)', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ externalInvoiceId: 'EXT-GLOBAL' }),
    } as never);
    const client = new FetchErpClient({ baseUrl: 'http://erp', apiKey: 'k' });
    const res = await client.sendInvoice(payload);
    expect(res.externalInvoiceId).toBe('EXT-GLOBAL');
    expect(globalFetch).toHaveBeenCalledWith(
      'http://erp/invoices',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
