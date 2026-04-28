// apps/api/src/storage/s3-blob-store.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.config.js';
import type { IBlobStore, PresignedUpload } from './storage-provider.interface.js';

export const S3_CLIENT = 'S3_CLIENT' as const;

export function defaultS3Client(region: string): S3Client {
  return new S3Client({ region });
}

@Injectable()
export class S3BlobStore implements IBlobStore {
  private readonly bucket: string;

  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(S3_CLIENT) private readonly client: S3Client,
  ) {
    this.bucket = config.getOrThrow('S3_ARTIFACTS_BUCKET', { infer: true });
  }

  async presignUpload(input: { key: string; contentType: string; ttlSeconds: number }): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: input.ttlSeconds });
    return {
      url,
      key: input.key,
      bucket: this.bucket,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }
}
