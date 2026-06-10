// apps/api/test/s3-stop-proof-url.signer.test.ts
// Mutation-killing unit test for src/dispatch/s3-stop-proof-url.signer.ts.
// Mirrors s3-blob-store.test.ts: mock the AWS SDK (GetObjectCommand +
// getSignedUrl), assert the EXACT arguments the signer passes (Bucket/Key,
// expiresIn) and that it surfaces the signed URL. No real S3 is contacted; the
// dispatch integration test uses a fake signer, so this is the only coverage of
// the concrete adapter.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const getObjectCommandCtorArgs: unknown[] = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    destroy(): void { /* no-op */ }
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
    await signer.presignProofUrl({ bucket: 'fleet-pilot-artifacts', key: 'manifests/co/m1/photo.jpg', ttlSeconds: 900 });
    expect(getObjectCommandCtorArgs).toHaveLength(1);
    expect(getObjectCommandCtorArgs[0]).toEqual({ Bucket: 'fleet-pilot-artifacts', Key: 'manifests/co/m1/photo.jpg' });
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
});
