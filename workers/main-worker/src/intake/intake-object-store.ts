// workers/main-worker/src/intake/intake-object-store.ts
// Port + S3 adapter: HEAD the uploaded object so the intake policy validates the
// ACTUAL object (content-type + size) instead of client-reported values, per
// 2026 best practice (verify MIME + size server-side; never trust the client).
// Pure policy stays infra-free; this is the hexagonal seam (mirrors
// intake-callback.ts). headObject returns null when the object is absent
// (NotFound/NoSuchKey/404) -> the caller maps that to object_missing.
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

export interface IntakeObjectHead {
  readonly contentType: string | null;
  readonly sizeBytes: number;
}

export interface IntakeObjectStore {
  /** HEAD the object. Returns null if it does not exist; throws on other errors. */
  headObject(input: { readonly bucket: string; readonly key: string }): Promise<IntakeObjectHead | null>;
}

export interface S3IntakeObjectStoreConfig {
  readonly region: string;
  readonly endpoint?: string | undefined;
  readonly accessKeyId?: string | undefined;
  readonly secretAccessKey?: string | undefined;
  readonly client?: S3Client | undefined;
}

export class S3IntakeObjectStore implements IntakeObjectStore {
  private readonly client: S3Client;
  constructor(config: S3IntakeObjectStoreConfig) {
    if (config.client) {
      this.client = config.client;
    } else {
      const cfg: Record<string, unknown> = { region: config.region, requestChecksumCalculation: 'WHEN_REQUIRED' };
      if (config.endpoint !== undefined && config.endpoint.length > 0) {
        cfg['endpoint'] = config.endpoint;
        cfg['forcePathStyle'] = true;
      }
      if (
        config.accessKeyId !== undefined && config.accessKeyId.length > 0 &&
        config.secretAccessKey !== undefined && config.secretAccessKey.length > 0
      ) {
        cfg['credentials'] = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
      }
      this.client = new S3Client(cfg);
    }
  }
  async headObject(input: { bucket: string; key: string }): Promise<IntakeObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }));
      return {
        contentType: res.ContentType ?? null,
        sizeBytes: typeof res.ContentLength === 'number' ? res.ContentLength : 0,
      };
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

interface S3ErrorShape {
  readonly name?: string;
  readonly Code?: string;
  readonly $metadata?: { readonly httpStatusCode?: number };
}
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as S3ErrorShape;
  if (e.name === 'NotFound' || e.name === 'NoSuchKey') return true;
  if (e.Code === 'NotFound' || e.Code === 'NoSuchKey') return true;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return false;
}
