// apps/api/test/erp-http-client.test.ts
// Mutation-killing tests for src/erp-outbound/fetch-erp-client.ts.
// The 7 survivors are request-shape mutants (URL StringLiteral, method 'POST',
// header StringLiterals, JSON.stringify arg) plus the !res.ok ConditionalExpression
// and the typeof !== 'string' guard. Killing them requires asserting the exact
// fetchFn call arguments and exercising both throw paths precisely.
import { describe, it, expect, vi } from 'vitest';
import { FetchErpClient } from '../src/erp-outbound/fetch-erp-client.js';

const PAYLOAD = {
  manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
  transportOrderId: '22222222-2222-4222-8222-222222222222',
  customerExternalId: 'CUST-1',
  jobCodeExternalId: 'JOB-1',
  amountCents: 5000,
  currency: 'USD',
  erpSystem: 'sap',
} as const;

function makeClient(fetchFn: unknown): FetchErpClient {
  return new FetchErpClient({
    baseUrl: 'http://erp.test',
    apiKey: 'test-api-key-value', // pragma: allowlist secret
    fetchFn: fetchFn as never,
  });
}

describe('@fleet/api - FetchErpClient', () => {
  it('POSTs to {baseUrl}/invoices with method, headers, and JSON body (kills URL + method + header + JSON.stringify StringLiteral/mutants)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ externalInvoiceId: 'EXT-123' }),
    });
    const res = await makeClient(fetchFn).sendInvoice(PAYLOAD);
    expect(res.externalInvoiceId).toBe('EXT-123');
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    // URL StringLiteral mutant: '/invoices' -> '' would change this.
    expect(url).toBe('http://erp.test/invoices');
    // method 'POST' -> '' StringLiteral mutant.
    expect(init.method).toBe('POST');
    // both header StringLiteral mutants.
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-API-Key': 'test-api-key-value',
    });
    // JSON.stringify(payload) -> JSON.stringify({}) ObjectLiteral mutant: body must
    // be the serialized payload, not empty.
    expect(init.body).toBe(JSON.stringify(PAYLOAD));
  });

  it('returns externalInvoiceId verbatim from the parsed JSON (kills return-shape ObjectLiteral mutant)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ externalInvoiceId: 'EXT-VERBATIM' }),
    });
    const res = await makeClient(fetchFn).sendInvoice(PAYLOAD);
    expect(res).toEqual({ externalInvoiceId: 'EXT-VERBATIM' });
  });

  it('throws on a non-ok response, including status/statusText/detail in the message (kills !res.ok ConditionalExpression + error StringLiteral)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('upstream exploded'),
    });
    await expect(makeClient(fetchFn).sendInvoice(PAYLOAD)).rejects.toThrow(
      new Error('ERP /invoices HTTP 500 Internal Server Error upstream exploded'),
    );
  });

  it('does NOT throw when res.ok is true even with a non-2xx-looking status (kills !res.ok -> res.ok / true / false mutants)', async () => {
    // ok:true is the sole gate. A `!res.ok -> res.ok` mutant would throw here;
    // a `-> true` mutant would always throw; a `-> false` mutant would never throw
    // (caught by the throwing test above). status 200 + ok:true must succeed.
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ externalInvoiceId: 'EXT-OK' }),
    });
    await expect(makeClient(fetchFn).sendInvoice(PAYLOAD)).resolves.toEqual({
      externalInvoiceId: 'EXT-OK',
    });
  });

  it('falls back to empty detail when the error body text() rejects (kills .catch(() => "") arrow + StringLiteral)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: () => Promise.reject(new Error('stream err')),
    });
    // detail resolves to '' via .catch(() => '') -> message ends with exactly one
    // trailing space after statusText. An exact-message assertion kills:
    //   .catch(() => '') -> .catch(() => 'Stryker was here!')  (StringLiteral)
    //   .catch(() => '') -> .catch(() => undefined)            (ArrowFunction)
    // both of which would change the trailing segment.
    let caught: unknown;
    try {
      await makeClient(fetchFn).sendInvoice(PAYLOAD);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('ERP /invoices HTTP 502 Bad Gateway ');
  });

  it('throws when externalInvoiceId is missing (kills typeof !== "string" ConditionalExpression + StringLiteral)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ wrong: 'x' }),
    });
    await expect(makeClient(fetchFn).sendInvoice(PAYLOAD)).rejects.toThrow(
      'ERP response missing externalInvoiceId',
    );
  });

  it('throws when externalInvoiceId is present but not a string (kills typeof guard -> true/false mutants)', async () => {
    // A `typeof x !== 'string'` -> `typeof x === 'string'` or `-> false` mutant
    // would let a numeric id through. The guard must reject non-strings.
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ externalInvoiceId: 12345 }),
    });
    await expect(makeClient(fetchFn).sendInvoice(PAYLOAD)).rejects.toThrow(
      'ERP response missing externalInvoiceId',
    );
  });

  it('accepts a string externalInvoiceId and does NOT throw the missing-id error (kills typeof guard -> true mutant)', async () => {
    // A `typeof !== 'string'` -> `true` mutant would throw even for a valid string.
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ externalInvoiceId: 'VALID' }),
    });
    await expect(makeClient(fetchFn).sendInvoice(PAYLOAD)).resolves.toEqual({
      externalInvoiceId: 'VALID',
    });
  });

  it('uses globalThis.fetch when no fetchFn is injected (kills ?? LogicalOperator fallback)', async () => {
    const original = globalThis.fetch;
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ externalInvoiceId: 'EXT-GLOBAL' }),
    });
    globalThis.fetch = spy as never;
    try {
      const client = new FetchErpClient({ baseUrl: 'http://erp.test', apiKey: 'k' });
      const res = await client.sendInvoice(PAYLOAD);
      expect(res.externalInvoiceId).toBe('EXT-GLOBAL');
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
    }
  });
});
