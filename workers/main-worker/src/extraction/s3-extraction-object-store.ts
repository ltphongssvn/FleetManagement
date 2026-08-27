// workers/main-worker/src/extraction/s3-extraction-object-store.ts
// S3 adapter for ExtractionObjectStore: GET the phieu-can image bytes for the
// VLM. Mirrors S3IntakeObjectStore (region/endpoint/creds handling, NotFound ->
// null); separate class because the port is GET-bytes, not HEAD-metadata.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { ExtractionObjectStore } from './extraction-flow.js';

export interface S3ExtractionObjectStoreConfig {
  readonly region: string;
  readonly endpoint?: string | undefined;
  readonly accessKeyId?: string | undefined;
  readonly secretAccessKey?: string | undefined;
  readonly client?: S3Client | undefined;
}

export class S3ExtractionObjectStore implements ExtractionObjectStore {
  private readonly client: S3Client;
  constructor(config: S3ExtractionObjectStoreConfig) {
    if (config.client) {
      this.client = config.client;
    } else {
      const cfg: Record<string, unknown> = {
        region: config.region,
        requestChecksumCalculation: 'WHEN_REQUIRED',
      };
      if (config.endpoint !== undefined && config.endpoint.length > 0) {
        cfg['endpoint'] = config.endpoint;
        cfg['forcePathStyle'] = true;
      }
      if (
        config.accessKeyId !== undefined &&
        config.accessKeyId.length > 0 &&
        config.secretAccessKey !== undefined &&
        config.secretAccessKey.length > 0
      ) {
        cfg['credentials'] = {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        };
      }
      this.client = new S3Client(cfg);
    }
  }

  async getObject(input: {
    readonly bucket: string;
    readonly key: string;
  }): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      if (!res.Body) return null;
      return await res.Body.transformToByteArray();
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
