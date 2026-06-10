// workers/main-worker/test/intake-object-store.test.ts
// RED-first unit tests for the S3 HEAD enrichment port. A fake S3Client (send())
// stands in for AWS, mirroring the fetchFn injection style of intake-callback.
import { describe, it, expect, vi } from 'vitest';
import { S3IntakeObjectStore } from '../src/intake/intake-object-store.js';
import type { S3Client } from '@aws-sdk/client-s3';

function fakeClient(send: (cmd: unknown) => Promise<unknown>): S3Client {
  return { send: vi.fn(send) } as unknown as S3Client;
}

describe('@fleet/main-worker - S3IntakeObjectStore', () => {
  it('maps a HEAD hit to {contentType, sizeBytes}', async () => {
    const store = new S3IntakeObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() => Promise.resolve({ ContentType: 'image/jpeg', ContentLength: 1400 })),
    });
    const head = await store.headObject({ bucket: 'b', key: 'k' });
    expect(head).toEqual({ contentType: 'image/jpeg', sizeBytes: 1400 });
  });

  it('defaults to null content-type and 0 size when HEAD omits them', async () => {
    const store = new S3IntakeObjectStore({ region: 'ap-southeast-1', client: fakeClient(() => Promise.resolve({})) });
    const head = await store.headObject({ bucket: 'b', key: 'k' });
    expect(head).toEqual({ contentType: null, sizeBytes: 0 });
  });
  it('treats Code NoSuchKey as object-absent (returns null)', async () => {
    const store = new S3IntakeObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() => Promise.reject(Object.assign(new Error('no such key'), { Code: 'NoSuchKey' }))),
    });
    const head = await store.headObject({ bucket: 'b', key: 'missing' });
    expect(head).toBeNull();
  });
  it('returns null when the object is absent (NotFound)', async () => {
    const store = new S3IntakeObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() => Promise.reject(Object.assign(new Error('not found'), { name: 'NotFound' }))),
    });
    const head = await store.headObject({ bucket: 'b', key: 'missing' });
    expect(head).toBeNull();
  });

  it('returns null on a 404 $metadata status', async () => {
    const store = new S3IntakeObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() => Promise.reject(Object.assign(new Error('not found'), { $metadata: { httpStatusCode: 404 } }))),
    });
    const head = await store.headObject({ bucket: 'b', key: 'missing' });
    expect(head).toBeNull();
  });

  it('rethrows non-NotFound errors (infra failures must retry)', async () => {
    const store = new S3IntakeObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() => Promise.reject(Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' }))),
    });
    await expect(store.headObject({ bucket: 'b', key: 'k' })).rejects.toThrow('AccessDenied');
  });

  // Construct without an injected client to exercise the real S3Client config
  // branches (region-only -> default chain; endpoint -> path-style; explicit
  // creds). Constructing an S3Client makes no network call.
  it('constructs an S3 client from region only (default credential chain)', () => {
    const store = new S3IntakeObjectStore({ region: 'ap-southeast-1' });
    expect(store).toBeInstanceOf(S3IntakeObjectStore);
  });
  it('constructs with a custom endpoint (path-style addressing for local S3)', () => {
    const store = new S3IntakeObjectStore({ region: 'ap-southeast-1', endpoint: 'http://localhost:4566' });
    expect(store).toBeInstanceOf(S3IntakeObjectStore);
  });
  it('constructs with explicit credentials', () => {
    const store = new S3IntakeObjectStore({
      region: 'ap-southeast-1',
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret_test', // pragma: allowlist secret
    });
    expect(store).toBeInstanceOf(S3IntakeObjectStore);
  });
});
