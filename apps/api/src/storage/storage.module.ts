// apps/api/src/storage/storage.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3BlobStore, S3_CLIENT, defaultS3Client } from './s3-blob-store.js';
import { BLOB_STORE } from './storage-provider.interface.js';
import type { Env } from '../config/env.config.js';
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const region = config.getOrThrow('AWS_REGION', { infer: true });
        const endpoint = config.get('S3_ENDPOINT_URL', { infer: true });
        const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
        const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', { infer: true });
        const overrides: { endpoint?: string; accessKeyId?: string; secretAccessKey?: string } = {};
        if (endpoint !== undefined) overrides.endpoint = endpoint;
        if (accessKeyId !== undefined) overrides.accessKeyId = accessKeyId;
        if (secretAccessKey !== undefined) overrides.secretAccessKey = secretAccessKey;
        return defaultS3Client(region, overrides);
      },
    },
    { provide: BLOB_STORE, useClass: S3BlobStore },
  ],
  exports: [BLOB_STORE],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class StorageModule {}
