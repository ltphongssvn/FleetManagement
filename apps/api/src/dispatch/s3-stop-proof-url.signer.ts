// apps/api/src/dispatch/s3-stop-proof-url.signer.ts
// S3 implementation of StopProofUrlSigner: presigns a GET URL for a proof photo
// object, mirroring S3BlobStore's client construction (region/endpoint/creds,
// requestChecksumCalculation WHEN_REQUIRED) and presign approach (getSignedUrl).
// Read-only GET; short TTL is enforced by the caller (controller).
//
// T-proof-host: like S3BlobStore.presignUpload, the signed origin is rewritten
// to the browser-reachable S3_PUBLIC_URL when configured (split-horizon
// LocalStack: in-network clients sign against http://localstack:4566, but the
// host browser can only resolve http://localhost:4566). Path + query (the
// signature) are preserved so the URL stays valid; absent/empty publicUrl is a
// no-op (prod uses the real S3 origin directly).
import { Inject, Injectable, Optional } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_CLIENT } from '../storage/s3-blob-store.js';
import type { StopProofUrlSigner } from './stop-proof-url.port.js';
@Injectable()
export class S3StopProofUrlSigner implements StopProofUrlSigner {
  constructor(
    @Inject(S3_CLIENT) private readonly client: S3Client,
    @Optional() private readonly publicUrl?: string,
  ) {}
  async presignProofUrl(input: {
    bucket: string;
    key: string;
    ttlSeconds: number;
  }): Promise<string> {
    const command = new GetObjectCommand({ Bucket: input.bucket, Key: input.key });
    const signed = await getSignedUrl(this.client, command, { expiresIn: input.ttlSeconds });
    return this.rewriteOrigin(signed);
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
    // WHATWG URL: assigning a portless host leaves the previous port in place;
    // copy port explicitly (empty string clears it for default-port origins).
    signed.port = pub.port;
    return signed.toString();
  }
}
