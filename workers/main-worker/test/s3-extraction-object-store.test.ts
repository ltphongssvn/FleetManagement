// workers/main-worker/test/s3-extraction-object-store.test.ts
// Coverage gate (mirrors intake-object-store.test.ts): GET-bytes port over a
// fake S3Client. Covers byte transform, missing Body, NotFound/NoSuchKey/404
// variants, non-404 rethrow, and the endpoint/creds config branches.
import { describe, it, expect, vi } from 'vitest';
import { S3ExtractionObjectStore } from '../src/extraction/s3-extraction-object-store.js';
import type { S3Client } from '@aws-sdk/client-s3';

function fakeClient(send: (cmd: unknown) => Promise<unknown>): S3Client {
  return { send: vi.fn(send) } as unknown as S3Client;
}

describe('@fleet/main-worker - S3ExtractionObjectStore', () => {
  it('returns the object bytes via transformToByteArray', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const store = new S3ExtractionObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() =>
        Promise.resolve({ Body: { transformToByteArray: () => Promise.resolve(bytes) } }),
      ),
    });
    expect(await store.getObject({ bucket: 'b', key: 'k' })).toEqual(bytes);
  });

  it('returns null when the response has no Body', async () => {
    const store = new S3ExtractionObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() => Promise.resolve({})),
    });
    expect(await store.getObject({ bucket: 'b', key: 'k' })).toBeNull();
  });

  it.each([
    ['name NotFound', { name: 'NotFound' }],
    ['name NoSuchKey', { name: 'NoSuchKey' }],
    ['Code NotFound', { Code: 'NotFound' }],
    ['Code NoSuchKey', { Code: 'NoSuchKey' }],
    ['http 404', { $metadata: { httpStatusCode: 404 } }],
  ])('treats %s as absent (null)', async (_label, shape) => {
    const store = new S3ExtractionObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() => Promise.reject(Object.assign(new Error('gone'), shape))),
    });
    expect(await store.getObject({ bucket: 'b', key: 'missing' })).toBeNull();
  });

  it('rethrows non-404 errors (retryable infra)', async () => {
    const store = new S3ExtractionObjectStore({
      region: 'ap-southeast-1',
      client: fakeClient(() =>
        Promise.reject(Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 403 } })),
      ),
    });
    await expect(store.getObject({ bucket: 'b', key: 'k' })).rejects.toThrow('denied');
  });

  it('rethrows non-object throwables (string)', async () => {
    const store = new S3ExtractionObjectStore({
      region: 'ap-southeast-1',
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- intentional non-Error rejection to cover the isNotFound non-object branch
      client: fakeClient(() => Promise.reject('boom')),
    });
    await expect(store.getObject({ bucket: 'b', key: 'k' })).rejects.toBe('boom');
  });

  it('constructs its own client with endpoint + creds branches (localstack shape)', () => {
    const a = new S3ExtractionObjectStore({
      region: 'us-west-2',
      endpoint: 'http://localstack:4566',
      accessKeyId: 'test',
      secretAccessKey: 'test',
    }); // pragma: allowlist secret
    const b = new S3ExtractionObjectStore({
      region: 'us-west-2',
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
    });
    expect(a).toBeInstanceOf(S3ExtractionObjectStore);
    expect(b).toBeInstanceOf(S3ExtractionObjectStore);
  });
});
