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
      useFactory: (config: ConfigService<Env, true>) => defaultS3Client(config.getOrThrow('AWS_REGION', { infer: true })),
    },
    { provide: BLOB_STORE, useClass: S3BlobStore },
  ],
  exports: [BLOB_STORE],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class StorageModule {}
