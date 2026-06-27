// apps/api/src/manifest/manifest.dto.ts
//
// SCHEMA-FIRST SSOT (P0-#5, 2026): the manifest upload RESPONSE envelopes
// (NegotiateUploadResponse / CommitUploadResponse) are NO LONGER defined here.
// They live once in @fleet/sync-protocol (manifest-response-contract.ts) and are
// re-exported below so this module's importers (manifest.controller,
// manifest.service) keep their import paths. The driver-app previously
// RE-DECLARED these response shapes in manifest-capture-flow.ts, and its commit
// response had DRIFTED (it omitted rejectionReasonCode, which this API emits);
// both now derive from the one shared schema.
//
// The REQUEST schemas below stay local: they are the Axis-1 inbound boundary
// validators for THIS endpoint (correlation id, size caps, capture-time stop ref,
// manual net-weight edit) -- not a shared/duplicated shape. The driver-app builds
// these requests inline, so there is nothing to consolidate on the request side.
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES, ManifestStopRefSchema } from '@fleet/sync-protocol';
export {
  NegotiateUploadResponseSchema,
  type NegotiateUploadResponse,
  CommitUploadResponseSchema,
  type CommitUploadResponse,
} from '@fleet/sync-protocol';

export const NegotiateUploadSchema = z.object({
  manifestCorrelationId: z.guid(),
  transportOrderId: z.guid(),
  contentType: z.enum(ALLOWED_MANIFEST_MIME_TYPES),
  expectedSizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  // Capture-time stop ref (Phiếu Cân association) — ManifestStopRefSchema from
  // @fleet/sync-protocol (Zod-first SSOT). EXPAND-only: absent/null for older
  // clients; when present the service resolves + persists manifest.stop_id.
  stop: ManifestStopRefSchema.nullish(),
});
export type NegotiateUploadInput = z.infer<typeof NegotiateUploadSchema>;

export const CommitUploadSchema = z.object({
  uploadSessionId: z.guid(),
  contentHash: z.string().min(32).max(128).optional(),
  actualSizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
});
export type CommitUploadInput = z.infer<typeof CommitUploadSchema>;

// Dispatcher manual net-weight entry (board edit). manifestId identifies the
// committed manifest; extractedNetWeightKg is the human-read weight (positive,
// finite). Strict: no extra keys. Mirrors the worker callback's strict parsing
// so the manual-edit boundary cannot drift.
export const SetManualNetWeightSchema = z
  .object({
    manifestId: z.guid(),
    extractedNetWeightKg: z.number().positive(),
  })
  .strict();
export type SetManualNetWeightInput = z.infer<typeof SetManualNetWeightSchema>;
