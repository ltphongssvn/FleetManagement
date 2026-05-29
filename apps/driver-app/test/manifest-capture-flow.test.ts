// apps/driver-app/test/manifest-capture-flow.test.ts
import { describe, it, expect, vi } from 'vitest';
import { negotiateAndUploadManifest } from '../src/manifest/manifest-capture-flow.js';

describe('@fleet/driver-app - negotiateAndUploadManifest', () => {
  it('happy path: negotiate -> PUT to S3 -> commit', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', manifestId: '88888888-8888-7888-8888-888888888888', state: 'verifying' }) });
    const result = await negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1, 2, 3]),
      fetchFn: fetchFn as never,
    });
    expect(result.manifestId).toBe('88888888-8888-7888-8888-888888888888');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws on negotiate failure', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'err' });
    await expect(negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    })).rejects.toThrow();
  });

  it('throws on S3 PUT failure', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'denied' });
    await expect(negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    })).rejects.toThrow();
  });

  it('throws on commit failure', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: 'bad gateway' });
    await expect(negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    })).rejects.toThrow(/commit/i);
  });

  it('forwards contentHash to commit when provided', async () => {
    let commitBody: string | undefined;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockImplementationOnce((_url: string, init: { body: string }) => {
        commitBody = init.body;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', manifestId: '88888888-8888-7888-8888-888888888888', state: 'verifying' }) });
      });
    await negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      contentHash: 'sha256:abc',
      fetchFn: fetchFn as never,
    });
    expect(commitBody).toContain('"contentHash":"sha256:abc"');
  });

  it('uses globalThis.fetch when fetchFn is not provided', async () => {
    const originalFetch = globalThis.fetch;
    const spy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', manifestId: '88888888-8888-7888-8888-888888888888', state: 'verifying' }) });
    globalThis.fetch = spy as never;
    try {
      const result = await negotiateAndUploadManifest({
        apiUrl: 'http://api', bearerToken: () => 't',
        manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
        transportOrderId: '22222222-2222-7222-8222-222222222222',
        contentType: 'image/jpeg',
        fileBytes: new Uint8Array([1, 2, 3]),
      });
      expect(result.manifestId).toBe('88888888-8888-7888-8888-888888888888');
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('@fleet/driver-app - negotiateAndUploadManifest mutation-hardening', () => {
  it('negotiate call: URL=`${apiUrl}/upload/negotiate`, method=POST, headers contain JSON+Bearer, body contains all input fields', async () => {
    const capturedCalls: { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const fetchFn = vi.fn().mockImplementation((url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
      capturedCalls.push({ url, init });
      if (url.endsWith('/upload/negotiate')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            uploadSessionId: '99999999-9999-7999-8999-999999999999',
            url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z',
          }),
        });
      }
      if (url === 'https://s3/up') return Promise.resolve({ ok: true });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          uploadSessionId: '99999999-9999-7999-8999-999999999999',
          manifestId: '88888888-8888-7888-8888-888888888888',
          state: 'verifying',
        }),
      });
    });
    await negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 'tok',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1, 2, 3, 4, 5]),
      fetchFn: fetchFn as never,
    });

    // Negotiate call
    const neg = capturedCalls[0];
    expect(neg).toBeDefined();
    if (!neg) throw new Error('no negotiate call');
    expect(neg.url).toBe('http://api/upload/negotiate');
    expect(neg.init.method).toBe('POST');
    expect(neg.init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' });
    const negBody = JSON.parse(neg.init.body ?? '{}');
    expect(negBody.manifestCorrelationId).toBe('11111111-1111-7111-8111-111111111111');
    expect(negBody.transportOrderId).toBe('22222222-2222-7222-8222-222222222222');
    expect(negBody.contentType).toBe('image/jpeg');
    expect(negBody.expectedSizeBytes).toBe(5);

    // S3 PUT call
    const put = capturedCalls[1];
    expect(put).toBeDefined();
    if (!put) throw new Error('no put call');
    expect(put.url).toBe('https://s3/up');
    expect(put.init.method).toBe('PUT');
    expect(put.init.headers).toEqual({ 'Content-Type': 'image/jpeg' });

    // Commit call
    const commit = capturedCalls[2];
    expect(commit).toBeDefined();
    if (!commit) throw new Error('no commit call');
    expect(commit.url).toBe('http://api/upload/commit');
    expect(commit.init.method).toBe('POST');
  });

  it('negotiate failure: error message names "/upload/negotiate HTTP <status> <statusText>"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    })).rejects.toThrow(/\/upload\/negotiate HTTP 503 Service Unavailable/);
  });

  it('S3 PUT failure: error message names "S3 PUT HTTP <status> <statusText>"', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' });
    await expect(negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    })).rejects.toThrow(/S3 PUT HTTP 403 Forbidden/);
  });

  it('commit failure: error message names "/upload/commit HTTP <status> <statusText>"', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999', url: 'https://s3/up', key: 'k', bucket: 'b', expiresAt: '2026-12-31T00:00:00Z' }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 409, statusText: 'Conflict' });
    await expect(negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    })).rejects.toThrow(/\/upload\/commit HTTP 409 Conflict/);
  });

  it('NegotiateResponseSchema rejects missing fields (kills schema -> {} mutant)', async () => {
    // Mutated NegotiateResponseSchema = z.object({}); a response with only uploadSessionId
    // would be accepted by the mutant; original requires url, key, bucket, expiresAt.
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ uploadSessionId: '99999999-9999-7999-8999-999999999999' }), // missing url, key, bucket, expiresAt
    });
    await expect(negotiateAndUploadManifest({
      apiUrl: 'http://api', bearerToken: () => 't',
      manifestCorrelationId: '11111111-1111-7111-8111-111111111111',
      transportOrderId: '22222222-2222-7222-8222-222222222222',
      contentType: 'image/jpeg',
      fileBytes: new Uint8Array([1]),
      fetchFn: fetchFn as never,
    })).rejects.toThrow();
  });
});
