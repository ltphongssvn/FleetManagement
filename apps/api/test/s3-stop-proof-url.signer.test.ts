// apps/api/test/s3-stop-proof-url.signer.test.ts
// Mutation-killing unit test for src/dispatch/s3-stop-proof-url.signer.ts.
// Mirrors s3-blob-store.test.ts: mock the AWS SDK (GetObjectCommand +
// getSignedUrl), assert the EXACT arguments the signer passes (Bucket/Key,
// expiresIn) and that it surfaces the signed URL. No real S3 is contacted; the
// dispatch integration test uses a fake signer, so this is the only coverage of
// the concrete adapter.
//
// T-proof-host (split-horizon read path): the PUT path (S3BlobStore) rewrites
// the signed origin to S3_PUBLIC_URL so the host browser can reach LocalStack;
// the GET proof signer never got the same treatment, so "Phiếu Cân" links
// carried http://localstack:4566 and died with DNS_PROBE_FINISHED_NXDOMAIN in
// the browser. The rewrite cases below drive an optional publicUrl constructor
// arg with S3BlobStore.rewriteOrigin semantics: swap protocol+host only,
// preserve path + query (the signature), no-op when publicUrl is absent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const getObjectCommandCtorArgs: unknown[] = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    destroy(): void {
      /* no-op */
    }
  },
  GetObjectCommand: class {
    readonly input: unknown;
    constructor(input?: unknown) {
      getObjectCommandCtorArgs.push(input);
      this.input = input;
    }
  },
}));
const mockGetSignedUrl = vi.fn();
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockGetSignedUrl }));
const { S3StopProofUrlSigner } = await import('../src/dispatch/s3-stop-proof-url.signer.js');
describe('@fleet/api - S3StopProofUrlSigner', () => {
  beforeEach(() => {
    getObjectCommandCtorArgs.length = 0;
    mockGetSignedUrl.mockReset();
  });
  it('builds a GetObjectCommand with the exact Bucket+Key (kills input ObjectLiteral/StringLiteral mutants)', async () => {
    mockGetSignedUrl.mockResolvedValue('https://signed.example/x');
    const client = {} as never;
    const signer = new S3StopProofUrlSigner(client);
    await signer.presignProofUrl({
      bucket: 'fleet-pilot-artifacts',
      key: 'manifests/co/m1/photo.jpg',
      ttlSeconds: 900,
    });
    expect(getObjectCommandCtorArgs).toHaveLength(1);
    expect(getObjectCommandCtorArgs[0]).toEqual({
      Bucket: 'fleet-pilot-artifacts',
      Key: 'manifests/co/m1/photo.jpg',
    });
  });
  it('passes the client, command, and { expiresIn: ttlSeconds } to getSignedUrl (kills expiresIn ObjectLiteral mutant)', async () => {
    mockGetSignedUrl.mockResolvedValue('https://signed.example/y');
    const client = { tag: 'the-client' } as never;
    const signer = new S3StopProofUrlSigner(client);
    await signer.presignProofUrl({ bucket: 'b', key: 'k', ttlSeconds: 1234 });
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const callArgs = mockGetSignedUrl.mock.calls[0];
    if (callArgs === undefined) throw new Error('expected getSignedUrl to be called');
    expect(callArgs[0]).toBe(client);
    expect(callArgs[2]).toEqual({ expiresIn: 1234 });
  });
  it('returns the signed URL verbatim (kills return-value mutants)', async () => {
    mockGetSignedUrl.mockResolvedValue('https://signed.example/proof?sig=abc');
    const signer = new S3StopProofUrlSigner({} as never);
    const url = await signer.presignProofUrl({ bucket: 'b', key: 'k', ttlSeconds: 60 });
    expect(url).toBe('https://signed.example/proof?sig=abc');
  });
  it('rewrites the signed origin to publicUrl, preserving path + query (T-proof-host)', async () => {
    mockGetSignedUrl.mockResolvedValue(
      'http://localstack:4566/fleet-pilot-artifacts/manifests/co/m1/p.jpg?X-Amz-Signature=abc&X-Amz-Expires=900',
    );
    const signer = new S3StopProofUrlSigner({} as never, 'http://localhost:4566');
    const url = await signer.presignProofUrl({
      bucket: 'fleet-pilot-artifacts',
      key: 'manifests/co/m1/p.jpg',
      ttlSeconds: 900,
    });
    expect(url).toBe(
      'http://localhost:4566/fleet-pilot-artifacts/manifests/co/m1/p.jpg?X-Amz-Signature=abc&X-Amz-Expires=900',
    );
  });
  it('rewrite swaps protocol as well as host (https public origin)', async () => {
    mockGetSignedUrl.mockResolvedValue('http://localstack:4566/b/k?X-Amz-Signature=s');
    const signer = new S3StopProofUrlSigner({} as never, 'https://cdn.example.com');
    const url = await signer.presignProofUrl({ bucket: 'b', key: 'k', ttlSeconds: 60 });
    expect(url).toBe('https://cdn.example.com/b/k?X-Amz-Signature=s');
  });
  it('returns the signed URL untouched when publicUrl is absent or empty (prod default chain)', async () => {
    mockGetSignedUrl.mockResolvedValue(
      'https://real-s3.ap-southeast-1.amazonaws.com/b/k?X-Amz-Signature=s',
    );
    const noArg = new S3StopProofUrlSigner({} as never);
    expect(await noArg.presignProofUrl({ bucket: 'b', key: 'k', ttlSeconds: 60 })).toBe(
      'https://real-s3.ap-southeast-1.amazonaws.com/b/k?X-Amz-Signature=s',
    );
    const emptyArg = new S3StopProofUrlSigner({} as never, '');
    expect(await emptyArg.presignProofUrl({ bucket: 'b', key: 'k', ttlSeconds: 60 })).toBe(
      'https://real-s3.ap-southeast-1.amazonaws.com/b/k?X-Amz-Signature=s',
    );
  });
});
