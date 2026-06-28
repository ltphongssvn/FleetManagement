// packages/sync-protocol/src/manifest-response-contract.ts
// Single source of truth for the manifest UPLOAD RESPONSE envelopes returned by
// POST /upload/negotiate and POST /upload/commit. Shared by the API (producer)
// and the driver-app (consumer of the presigned URL + commit ack).
//
// Previously defined TWICE: apps/api manifest.dto.ts
// (NegotiateUploadResponseSchema / CommitUploadResponseSchema) and apps/driver-app
// manifest-capture-flow.ts (NegotiateResponseSchema / CommitResponseSchema). The
// commit response had DRIFTED -- the API emits rejectionReasonCode, the driver-app
// copy omitted it (silently dropped). These schemas are the API's SUPERSET so the
// producer stays valid and the driver-app gains the field.
//
// Tolerant/strip (NOT .strict()): an upload response is producer/BFF JSON the
// consumer should accept without re-validating ISO timestamp format. expiresAt is
// therefore z.string() (the API emits an ISO string via toISOString(); the
// driver-app never reads the field) -- EXPAND-only, mirroring DispatchBoardRow.
//
// Only the RESPONSE envelopes live here. The REQUEST schemas (NegotiateUploadSchema
// / CommitUploadSchema) stay in apps/api as the Axis-1 inbound boundary validators
// (correlation id, size limits, stop ref); the driver-app builds those requests
// inline, so there is no duplicated request shape to consolidate. No brands are
// involved (ManifestCorrelationId appears only on the request), so z.infer here
// strips nothing.
import { z } from 'zod';

export const NegotiateUploadResponseSchema = z.object({
  uploadSessionId: z.guid(),
  url: z.url(),
  key: z.string(),
  bucket: z.string(),
  expiresAt: z.string(),
});
export type NegotiateUploadResponse = z.infer<typeof NegotiateUploadResponseSchema>;

export const CommitUploadResponseSchema = z.object({
  uploadSessionId: z.guid(),
  manifestId: z.guid(),
  state: z.literal('verifying'),
  rejectionReasonCode: z.string().optional(),
});
export type CommitUploadResponse = z.infer<typeof CommitUploadResponseSchema>;
