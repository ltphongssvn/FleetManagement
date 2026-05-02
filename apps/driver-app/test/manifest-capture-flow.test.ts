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
});
