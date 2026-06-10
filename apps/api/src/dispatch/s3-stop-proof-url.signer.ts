// apps/api/src/dispatch/s3-stop-proof-url.signer.ts
// S3 implementation of StopProofUrlSigner: presigns a GET URL for a proof photo
// object, mirroring S3BlobStore's client construction (region/endpoint/creds,
// requestChecksumCalculation WHEN_REQUIRED) and presign approach (getSignedUrl).
// Read-only GET; short TTL is enforced by the caller (controller).
import { Inject, Injectable } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_CLIENT } from '../storage/s3-blob-store.js';
import type { StopProofUrlSigner } from './stop-proof-url.port.js';
@Injectable()
export class S3StopProofUrlSigner implements StopProofUrlSigner {
  constructor(@Inject(S3_CLIENT) private readonly client: S3Client) {}
  async presignProofUrl(input: { bucket: string; key: string; ttlSeconds: number }): Promise<string> {
    const command = new GetObjectCommand({ Bucket: input.bucket, Key: input.key });
    return getSignedUrl(this.client, command, { expiresIn: input.ttlSeconds });
  }
}
