// apps/api/test/s3-blob-store.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockGetSignedUrl = vi.fn();
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockGetSignedUrl }));

const { S3BlobStore, defaultS3Client } = await import('../src/storage/s3-blob-store.js');

describe('@fleet/api - S3BlobStore', () => {
  const fakeClient = {} as never;
  const fakeConfig = {
    getOrThrow: vi.fn().mockReturnValue('fleet-bucket'),
  } as never;

  it('presignUpload returns url + key + bucket + expiresAt', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/signed?token=abc');
    const store = new S3BlobStore(fakeConfig, fakeClient);
    const result = await store.presignUpload({ key: 'k1.jpg', contentType: 'image/jpeg', ttlSeconds: 600 });

    expect(result.url).toBe('https://s3.example/signed?token=abc');
    expect(result.key).toBe('k1.jpg');
    expect(result.bucket).toBe('fleet-bucket');
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('expiresAt reflects ttlSeconds', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/signed');
    const store = new S3BlobStore(fakeConfig, fakeClient);
    const before = Date.now();
    const result = await store.presignUpload({ key: 'k2.pdf', contentType: 'application/pdf', ttlSeconds: 300 });
    const ttlMs = result.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThanOrEqual(299_000);
    expect(ttlMs).toBeLessThanOrEqual(301_000);
  });

  it('defaultS3Client constructs an S3Client with given region', () => {
    const client = defaultS3Client('us-west-2');
    expect(client).toBeDefined();
  });
});
