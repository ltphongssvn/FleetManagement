// apps/api/src/dispatch/stop-proof-url.port.ts
// Port: mint a short-lived presigned S3 GET URL for a committed manifest's proof
// photo, so ops-web can render a \"Phiếu Cân\" link without exposing the private
// bucket. Hexagonal seam (mirrors the worker's S3 object-store port): the
// controller depends on this interface; the S3 impl is injected, and tests fake it.
export interface StopProofUrlSigner {
  /** Presigned GET URL for the object at (bucket, key); ttl seconds. */
  presignProofUrl(input: { bucket: string; key: string; ttlSeconds: number }): Promise<string>;
}
export const STOP_PROOF_URL_SIGNER = 'STOP_PROOF_URL_SIGNER' as const;
