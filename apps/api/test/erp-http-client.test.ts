// apps/api/test/erp-http-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FetchErpClient } from '../src/erp-outbound/fetch-erp-client.js';

describe('@fleet/api - FetchErpClient', () => {
  it('POSTs invoice and returns externalInvoiceId on 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ externalInvoiceId: 'EXT-123' }),
    });
    const client = new FetchErpClient({ baseUrl: 'http://erp.test', apiKey: 'k', fetchFn: fetchFn as never });
    const res = await client.sendInvoice({
      manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
      transportOrderId: '22222222-2222-4222-8222-222222222222',
      customerExternalId: 'CUST-1', jobCodeExternalId: 'JOB-1',
      amountCents: 5000, currency: 'USD', erpSystem: 'sap',
    });
    expect(res.externalInvoiceId).toBe('EXT-123');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('throws on non-2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'err', text: () => Promise.resolve('') });
    const client = new FetchErpClient({ baseUrl: 'http://erp.test', apiKey: 'k', fetchFn: fetchFn as never });
    await expect(client.sendInvoice({
      manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
      transportOrderId: '22222222-2222-4222-8222-222222222222',
      customerExternalId: 'CUST-1', jobCodeExternalId: 'JOB-1',
      amountCents: 5000, currency: 'USD', erpSystem: 'sap',
    })).rejects.toThrow();
  });

  it('throws when response missing externalInvoiceId', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ wrong: 'x' }),
    });
    const client = new FetchErpClient({ baseUrl: 'http://erp.test', apiKey: 'k', fetchFn: fetchFn as never });
    await expect(client.sendInvoice({
      manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
      transportOrderId: '22222222-2222-4222-8222-222222222222',
      customerExternalId: 'CUST-1', jobCodeExternalId: 'JOB-1',
      amountCents: 5000, currency: 'USD', erpSystem: 'sap',
    })).rejects.toThrow(/externalInvoiceId/);
  });

  it('handles text() failure when error response body unreadable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false, status: 502, statusText: 'bad', text: () => Promise.reject(new Error('stream err')),
    });
    const client = new FetchErpClient({ baseUrl: 'http://erp.test', apiKey: 'k', fetchFn: fetchFn as never });
    await expect(client.sendInvoice({
      manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
      transportOrderId: '22222222-2222-4222-8222-222222222222',
      customerExternalId: 'CUST-1', jobCodeExternalId: 'JOB-1',
      amountCents: 5000, currency: 'USD', erpSystem: 'sap',
    })).rejects.toThrow(/HTTP 502/);
  });
});
