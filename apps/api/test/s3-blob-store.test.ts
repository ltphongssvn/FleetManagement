// apps/api/test/s3-blob-store.test.ts
// Mutation-killing tests for src/storage/s3-blob-store.ts.
// The 6 survivors are all constructor/call-argument ObjectLiteral / StringLiteral /
// BooleanLiteral mutants. Killing them requires asserting the exact arguments passed
// into S3Client, PutObjectCommand, and getSignedUrl -- not just the returned shape.
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Capture constructor args for the AWS SDK classes.
const s3ClientCtorArgs: unknown[] = [];
const putObjectCommandCtorArgs: unknown[] = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(cfg?: unknown) {
      s3ClientCtorArgs.push(cfg);
    }
    // Present only to satisfy no-extraneous-class; never called by the unit under test.
    destroy(): void {
      /* no-op */
    }
  },
  PutObjectCommand: class {
    readonly input: unknown;
    constructor(input?: unknown) {
      putObjectCommandCtorArgs.push(input);
      this.input = input;
    }
  },
}));
const mockGetSignedUrl = vi.fn();
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockGetSignedUrl }));
const { S3BlobStore, defaultS3Client, S3_CLIENT } = await import(
  '../src/storage/s3-blob-store.js'
);
// SDK v3 injects x-amz-checksum-crc32 into presigned PUT URLs by default;
// the client sets requestChecksumCalculation:'WHEN_REQUIRED' so presigned
// PUTs stay clean (see s3-blob-store-checksum.test.ts).
const CHK = { requestChecksumCalculation: 'WHEN_REQUIRED' } as const;
describe('@fleet/api - S3BlobStore', () => {
  beforeEach(() => {
    s3ClientCtorArgs.length = 0;
    putObjectCommandCtorArgs.length = 0;
    mockGetSignedUrl.mockReset();
  });
  // --- defaultS3Client ---
  it('defaultS3Client passes { region } into the S3Client constructor (kills S3Client({}) ObjectLiteral mutant)', () => {
    defaultS3Client('us-west-2');
    expect(s3ClientCtorArgs).toHaveLength(1);
    expect(s3ClientCtorArgs[0]).toEqual({ region: 'us-west-2', ...CHK });
  });
  it('defaultS3Client forwards the region verbatim, not a constant (kills region StringLiteral mutants)', () => {
    defaultS3Client('eu-central-1');
    expect(s3ClientCtorArgs[0]).toEqual({ region: 'eu-central-1', ...CHK });
  });
  // --- constructor: bucket resolution ---
  it('constructor reads S3_ARTIFACTS_BUCKET from config with infer:true (kills key StringLiteral + {infer:true} ObjectLiteral + infer BooleanLiteral)', () => {
    const getOrThrow = vi.fn().mockReturnValue('fleet-bucket');
    const fakeConfig = { getOrThrow } as never;
    new S3BlobStore(fakeConfig, {} as never);
    expect(getOrThrow).toHaveBeenCalledWith('S3_ARTIFACTS_BUCKET', { infer: true });
  });
  it('S3_CLIENT injection token is the exact string "S3_CLIENT" (kills token StringLiteral mutant)', () => {
    expect(S3_CLIENT).toBe('S3_CLIENT');
  });
  // --- presignUpload ---
  it('presignUpload builds PutObjectCommand with Bucket, Key, ContentType (kills PutObjectCommand({}) ObjectLiteral mutant)', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/signed?token=abc');
    const fakeConfig = { getOrThrow: vi.fn().mockReturnValue('fleet-bucket') } as never;
    const store = new S3BlobStore(fakeConfig, {} as never);
    await store.presignUpload({ key: 'k1.jpg', contentType: 'image/jpeg', ttlSeconds: 600 });
    expect(putObjectCommandCtorArgs).toHaveLength(1);
    expect(putObjectCommandCtorArgs[0]).toEqual({
      Bucket: 'fleet-bucket',
      Key: 'k1.jpg',
      ContentType: 'image/jpeg',
    });
  });
  it('presignUpload calls getSignedUrl with the client, the command, and { expiresIn: ttlSeconds } (kills getSignedUrl({}) ObjectLiteral mutant)', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/signed');
    const fakeClient = { marker: 'the-client' } as never;
    const fakeConfig = { getOrThrow: vi.fn().mockReturnValue('fleet-bucket') } as never;
    const store = new S3BlobStore(fakeConfig, fakeClient);
    await store.presignUpload({ key: 'k2.pdf', contentType: 'application/pdf', ttlSeconds: 300 });
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [clientArg, commandArg, optionsArg] = mockGetSignedUrl.mock.calls[0] as [
      unknown,
      { input: unknown },
      unknown,
    ];
    expect(clientArg).toBe(fakeClient);
    expect(commandArg.input).toEqual({
      Bucket: 'fleet-bucket',
      Key: 'k2.pdf',
      ContentType: 'application/pdf',
    });
    expect(optionsArg).toEqual({ expiresIn: 300 });
  });
  it('presignUpload returns url + key + bucket + expiresAt (kills return-shape ObjectLiteral mutant)', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/signed?token=abc');
    const fakeConfig = { getOrThrow: vi.fn().mockReturnValue('fleet-bucket') } as never;
    const store = new S3BlobStore(fakeConfig, {} as never);
    const result = await store.presignUpload({
      key: 'k1.jpg',
      contentType: 'image/jpeg',
      ttlSeconds: 600,
    });
    expect(result.url).toBe('https://s3.example/signed?token=abc');
    expect(result.key).toBe('k1.jpg');
    expect(result.bucket).toBe('fleet-bucket');
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
  it('expiresAt = now + ttlSeconds*1000 (kills ttlSeconds*1000 ArithmeticOperator + Date.now()+ ArithmeticOperator)', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example/signed');
    const fakeConfig = { getOrThrow: vi.fn().mockReturnValue('fleet-bucket') } as never;
    const store = new S3BlobStore(fakeConfig, {} as never);
    const before = Date.now();
    const result = await store.presignUpload({
      key: 'k2.pdf',
      contentType: 'application/pdf',
      ttlSeconds: 300,
    });
    const after = Date.now();
    const ttlMs = result.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThanOrEqual(300_000);
    expect(ttlMs).toBeLessThanOrEqual(300_000 + (after - before) + 50);
  });
});
