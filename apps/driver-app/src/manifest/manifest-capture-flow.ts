// apps/driver-app/src/manifest/manifest-capture-flow.ts
// Orchestrates the 3-step manifest upload flow per PDF Day-One #5:
//   1. POST /upload/negotiate -> returns presigned URL + uploadSessionId
//   2. PUT bytes to S3 presigned URL
//   3. POST /upload/commit -> transitions state to verifying
// Worker-side intake validates and calls /upload/intake-result to finalize.
//
// SCHEMA-FIRST SSOT (P0-#5, 2026): the negotiate/commit RESPONSE envelopes are
// imported from @fleet/sync-protocol (manifest-response-contract.ts), the SINGLE
// definition shared with the API. This module previously RE-DECLARED them, and its
// commit-response schema had DRIFTED -- it omitted rejectionReasonCode, which the
// API emits. Parsing against the shared superset schema fixes that silent drop.
import { NegotiateUploadResponseSchema, CommitUploadResponseSchema } from '@fleet/sync-protocol';

export interface ManifestUploadInput {
  readonly apiUrl: string;
  readonly bearerToken: () => string | Promise<string>;
  readonly manifestCorrelationId: string;
  readonly transportOrderId: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';
  readonly fileBytes: Uint8Array;
  readonly contentHash?: string;
  /** 1-based stop.sequence for capture-time association (ManifestStopRef,
   *  @fleet/sync-protocol). Omitted -> no stop field sent (legacy back-compat). */
  readonly stopSequence?: number;
  readonly fetchFn?: typeof globalThis.fetch;
}

export interface ManifestUploadResult {
  readonly manifestId: string;
  readonly uploadSessionId: string;
}

export async function negotiateAndUploadManifest(
  input: ManifestUploadInput,
): Promise<ManifestUploadResult> {
  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const token = await input.bearerToken();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // 1. Negotiate
  const negRes = await fetchFn(`${input.apiUrl}/upload/negotiate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      manifestCorrelationId: input.manifestCorrelationId,
      transportOrderId: input.transportOrderId,
      contentType: input.contentType,
      expectedSizeBytes: input.fileBytes.byteLength,
      ...(input.stopSequence !== undefined
        ? { stop: { stopId: null, stopSequence: input.stopSequence } }
        : {}),
    }),
  });
  if (!negRes.ok) {
    throw new Error(`/upload/negotiate HTTP ${String(negRes.status)} ${negRes.statusText}`);
  }
  const negJson = NegotiateUploadResponseSchema.parse(await negRes.json());

  // 2. PUT to S3
  const putRes = await fetchFn(negJson.url, {
    method: 'PUT',
    headers: { 'Content-Type': input.contentType },
    body: input.fileBytes as unknown as BodyInit,
  });
  if (!putRes.ok) {
    throw new Error(`S3 PUT HTTP ${String(putRes.status)} ${putRes.statusText}`);
  }

  // 3. Commit
  const commitRes = await fetchFn(`${input.apiUrl}/upload/commit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uploadSessionId: negJson.uploadSessionId,
      actualSizeBytes: input.fileBytes.byteLength,
      ...(input.contentHash ? { contentHash: input.contentHash } : {}),
    }),
  });
  if (!commitRes.ok) {
    throw new Error(`/upload/commit HTTP ${String(commitRes.status)} ${commitRes.statusText}`);
  }
  const commitJson = CommitUploadResponseSchema.parse(await commitRes.json());
  return { manifestId: commitJson.manifestId, uploadSessionId: commitJson.uploadSessionId };
}
