// apps/api/src/storage/s3-blob-store.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.config.js';
import type { IBlobStore, PresignedUpload } from './storage-provider.interface.js';
export const S3_CLIENT = 'S3_CLIENT' as const;
export interface S3ClientOverrides {
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
}
// region-only -> AWS default credential chain (production, unchanged).
// endpoint -> path-style addressing (LocalStack/MinIO need it).
// explicit creds -> forwarded for local S3 that has no IAM role.
// requestChecksumCalculation WHEN_REQUIRED -> SDK v3 otherwise injects
// x-amz-checksum-crc32 into presigned PUT URLs; a client PUTting raw
// bytes cannot satisfy it and S3/LocalStack reject with 400. WHEN_REQUIRED
// keeps presigned PUTs free of the unfulfillable checksum header.
export function defaultS3Client(region: string, overrides?: S3ClientOverrides): S3Client {
  const cfg: Record<string, unknown> = { region, requestChecksumCalculation: 'WHEN_REQUIRED' };
  if (overrides?.endpoint !== undefined && overrides.endpoint.length > 0) {
    cfg['endpoint'] = overrides.endpoint;
    cfg['forcePathStyle'] = true;
  }
  if (
    overrides?.accessKeyId !== undefined &&
    overrides.accessKeyId.length > 0 &&
    overrides.secretAccessKey !== undefined &&
    overrides.secretAccessKey.length > 0
  ) {
    cfg['credentials'] = {
      accessKeyId: overrides.accessKeyId,
      secretAccessKey: overrides.secretAccessKey,
    };
  }
  return new S3Client(cfg);
}
@Injectable()
export class S3BlobStore implements IBlobStore {
  private readonly bucket: string;
  // Optional browser-reachable S3 origin. Presigned URLs are signed against
  // the internal endpoint (e.g. http://localstack:4566) which a browser on
  // the host cannot resolve; when set, presignUpload swaps the URL origin to
  // this value. Path-style addressing means only the origin changes, so the
  // signature (a query param) stays valid. Unset in production.
  private readonly publicUrl: string | undefined;
  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(S3_CLIENT) private readonly client: S3Client,
  ) {
    this.bucket = config.getOrThrow('S3_ARTIFACTS_BUCKET', { infer: true });
    this.publicUrl = config.get('S3_PUBLIC_URL', { infer: true });
  }
  async presignUpload(input: { key: string; contentType: string; ttlSeconds: number }): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
    });
    const signed = await getSignedUrl(this.client, command, { expiresIn: input.ttlSeconds });
    const url = this.rewriteOrigin(signed);
    return {
      url,
      key: input.key,
      bucket: this.bucket,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }
  // Swap the signed URL origin to the browser-reachable public origin.
  // Preserves path + query (the signature), so the URL stays valid.
  private rewriteOrigin(signedUrl: string): string {
    if (this.publicUrl === undefined || this.publicUrl.length === 0) {
      return signedUrl;
    }
    const signed = new URL(signedUrl);
    const pub = new URL(this.publicUrl);
    signed.protocol = pub.protocol;
    signed.host = pub.host;
    return signed.toString();
  }
}
