// apps/api/src/dispatch/dispatch.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchRosterSplitController } from './dispatch-roster-split.controller.js';
import { DispatchRosterSplitService, ROSTER_SPLIT_NOW, type NowFn } from './dispatch-roster-split.service.js';
import { DriverAssignmentsController } from './driver-assignments.controller.js';
import { DriverDeliveryController } from './driver-delivery.controller.js';
import { DriverDeliveryService } from './driver-delivery.service.js';
import { defaultS3Client } from '../storage/s3-blob-store.js';
import { S3StopProofUrlSigner } from './s3-stop-proof-url.signer.js';
import { STOP_PROOF_URL_SIGNER } from './stop-proof-url.port.js';
import type { Env } from '../config/env.config.js';
import type { S3Client } from '@aws-sdk/client-s3';
// Dispatch owns its own S3 client for proof-photo GET presigning (StorageModule
// does not export S3_CLIENT). Same construction as StorageModule: region from
// AWS_REGION, optional endpoint/creds for local S3.
//
// ROSTER_SPLIT_NOW binds the real wall clock for the dispatched-vs-idle panel.
// The Asia/Ho_Chi_Minh day window is derived from this instant, so the clock is
// injected (never read inline) and tests substitute a fixed Date - mirroring
// OWNER_METRICS_NOW in OwnerModule.
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    DispatchController,
    DispatchRosterSplitController,
    DriverAssignmentsController,
    DriverDeliveryController,
  ],
  providers: [
    DriverDeliveryService,
    DispatchRosterSplitService,
    { provide: ROSTER_SPLIT_NOW, useValue: (() => new Date()) satisfies NowFn },
    {
      provide: STOP_PROOF_URL_SIGNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): S3StopProofUrlSigner => {
        const region = config.getOrThrow('AWS_REGION', { infer: true });
        const endpoint = config.get('S3_ENDPOINT_URL', { infer: true });
        const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
        const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', { infer: true });
        const overrides: { endpoint?: string; accessKeyId?: string; secretAccessKey?: string } = {};
        if (endpoint !== undefined) overrides.endpoint = endpoint;
        if (accessKeyId !== undefined) overrides.accessKeyId = accessKeyId;
        if (secretAccessKey !== undefined) overrides.secretAccessKey = secretAccessKey;
        const client: S3Client = defaultS3Client(region, overrides);
        // T-proof-host: browser-reachable origin for proof GET URLs, mirroring
        // S3BlobStore.presignUpload (split-horizon LocalStack rewrite).
        const publicUrl = config.get('S3_PUBLIC_URL', { infer: true });
        return new S3StopProofUrlSigner(client, publicUrl);
      },
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DispatchModule {}
