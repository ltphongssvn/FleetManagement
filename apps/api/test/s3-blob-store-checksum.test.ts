// apps/api/test/s3-blob-store-checksum.test.ts
// TDD RED: AWS SDK v3 injects x-amz-checksum-crc32 into presigned PUT URLs
// by default; clients PUT raw bytes without that checksum -> S3 (and
// LocalStack) reject with 400 InvalidRequest. The S3 client must set
// requestChecksumCalculation: 'WHEN_REQUIRED' so presigned PUTs are clean.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ctorArgs: unknown[] = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(cfg?: unknown) {
      ctorArgs.push(cfg);
    }
    destroy(): void {
      /* no-op */
    }
  },
  PutObjectCommand: class {
    constructor(public input?: unknown) {}
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

const { defaultS3Client } = await import('../src/storage/s3-blob-store.js');

describe('@fleet/api - S3 client checksum behavior', () => {
  beforeEach(() => {
    ctorArgs.length = 0;
  });

  it('region-only client sets requestChecksumCalculation WHEN_REQUIRED', () => {
    defaultS3Client('us-west-2');
    expect(ctorArgs[0]).toEqual({
      region: 'us-west-2',
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  });

  it('endpoint client also sets requestChecksumCalculation WHEN_REQUIRED', () => {
    defaultS3Client('us-west-2', {
      endpoint: 'http://localstack:4566',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }); // pragma: allowlist secret
    expect(ctorArgs[0]).toEqual({
      region: 'us-west-2',
      endpoint: 'http://localstack:4566',
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, // pragma: allowlist secret
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  });
});
