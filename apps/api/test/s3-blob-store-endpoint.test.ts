// apps/api/test/s3-blob-store-endpoint.test.ts
// TDD: defaultS3Client honors an optional S3 endpoint override + path-style
// + explicit credentials so the stack can presign against a local S3
// (LocalStack) in Docker Compose. Production (no endpoint) keeps the
// region-only AWS default credential chain. All clients also set
// requestChecksumCalculation:'WHEN_REQUIRED' (see s3-blob-store-checksum).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s3ClientCtorArgs: unknown[] = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(cfg?: unknown) {
      s3ClientCtorArgs.push(cfg);
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
const CHK = { requestChecksumCalculation: 'WHEN_REQUIRED' } as const;

describe('@fleet/api - defaultS3Client endpoint override', () => {
  beforeEach(() => {
    s3ClientCtorArgs.length = 0;
  });

  it('region-only call stays { region } (no endpoint, no creds — prod path unchanged)', () => {
    defaultS3Client('us-west-2');
    expect(s3ClientCtorArgs[0]).toEqual({ region: 'us-west-2', ...CHK });
  });

  it('endpoint option adds endpoint + forcePathStyle:true (LocalStack needs path-style)', () => {
    defaultS3Client('us-west-2', { endpoint: 'http://localstack:4566' });
    expect(s3ClientCtorArgs[0]).toEqual({
      region: 'us-west-2',
      endpoint: 'http://localstack:4566',
      forcePathStyle: true,
      ...CHK,
    });
  });

  it('explicit credentials are forwarded when provided', () => {
    defaultS3Client('us-west-2', {
      endpoint: 'http://localstack:4566',
      accessKeyId: 'test',
      secretAccessKey: 'test', // pragma: allowlist secret
    });
    expect(s3ClientCtorArgs[0]).toEqual({
      region: 'us-west-2',
      endpoint: 'http://localstack:4566',
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' }, // pragma: allowlist secret
      ...CHK,
    });
  });

  it('credentials without endpoint still forwarded, no forcePathStyle', () => {
    defaultS3Client('eu-central-1', { accessKeyId: 'k', secretAccessKey: 's' });
    expect(s3ClientCtorArgs[0]).toEqual({
      region: 'eu-central-1',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      ...CHK,
    });
  });
});
