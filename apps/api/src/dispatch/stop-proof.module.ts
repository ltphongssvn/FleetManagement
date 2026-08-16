// apps/api/src/dispatch/stop-proof.module.ts
// Provider-only module owning the ONE StopProofUrlSigner binding.
//
// Why it exists: two read surfaces now mint presigned Phieu Can GET URLs -- the
// dispatch BOARD (DispatchController) and the dispatcher REVIEW row
// (TransportOrdersService). The provider previously lived inside DispatchModule
// alongside its controllers, so the only ways to share it were (a) importing a
// controller-bearing feature module from a read module, or (b) redefining the
// provider -- which would give the two surfaces independently-configured
// signers (different endpoint/public-URL overrides = links that work on one
// screen and 403 on the other). Both are the Axis-2 DI-duplication trap.
//
// Extracting the binding here keeps ONE definition, importable by anyone, with
// zero controller coupling. Construction is unchanged from the original
// DispatchModule factory: region from AWS_REGION, optional endpoint/credential
// overrides for local S3, and S3_PUBLIC_URL for the browser-reachable origin
// (split-horizon LocalStack rewrite, mirroring S3BlobStore.presignUpload).
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { defaultS3Client } from '../storage/s3-blob-store.js';
import { S3StopProofUrlSigner } from './s3-stop-proof-url.signer.js';
import { STOP_PROOF_URL_SIGNER } from './stop-proof-url.port.js';
import type { Env } from '../config/env.config.js';
import type { S3Client } from '@aws-sdk/client-s3';

@Module({
  providers: [
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
        const publicUrl = config.get('S3_PUBLIC_URL', { infer: true });
        return new S3StopProofUrlSigner(client, publicUrl);
      },
    },
  ],
  exports: [STOP_PROOF_URL_SIGNER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class StopProofModule {}
