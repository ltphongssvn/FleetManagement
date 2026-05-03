// workers/main-worker/test/fetch-erp-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FetchErpClient } from '../src/erp/fetch-erp-client.js';
import type { MappedErpPayload } from '../src/erp/erp-policy.js';

const payload: MappedErpPayload = {
  manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
  transportOrderId: '22222222-2222-7222-8222-222222222222',
  customerExternalId: 'CUST-1',
  jobCodeExternalId: 'JOB-EXT-1',
  amountCents: 5000,
  currency: 'USD',
};

describe('@fleet/main-worker - FetchErpClient', () => {
  it('returns externalInvoiceId on 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ externalInvoiceId: 'EXT-42' }),
    });
    const client = new FetchErpClient({ baseUrl: 'http://erp', apiKey: 'k', fetchFn: fetchFn as never });
    const res = await client.sendInvoice(payload);
    expect(res.externalInvoiceId).toBe('EXT-42');
    expect(fetchFn).toHaveBeenCalledWith('http://erp/invoices', expect.objectContaining({ method: 'POST' }));
  });

  it('throws on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: 'err', text: () => Promise.resolve('boom'),
    });
    const client = new FetchErpClient({ baseUrl: 'http://erp', apiKey: 'k', fetchFn: fetchFn as never });
    await expect(client.sendInvoice(payload)).rejects.toThrow(/HTTP 500/);
  });

  it('throws when response missing externalInvoiceId', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ wrong: 'x' }),
    });
    const client = new FetchErpClient({ baseUrl: 'http://erp', apiKey: 'k', fetchFn: fetchFn as never });
    await expect(client.sendInvoice(payload)).rejects.toThrow(/externalInvoiceId/);
  });

  it('handles text() failure gracefully when error response body unreadable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false, status: 502, statusText: 'bad', text: () => Promise.reject(new Error('stream err')),
    });
    const client = new FetchErpClient({ baseUrl: 'http://erp', apiKey: 'k', fetchFn: fetchFn as never });
    await expect(client.sendInvoice(payload)).rejects.toThrow(/HTTP 502/);
  });
});
