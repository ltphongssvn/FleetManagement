// apps/api/src/manifest/manifest.dto.ts
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES, ManifestStopRefSchema } from '@fleet/sync-protocol';

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

export const NegotiateUploadResponseSchema = z.object({
  uploadSessionId: z.guid(),
  url: z.url(),
  key: z.string(),
  bucket: z.string(),
  expiresAt: z.iso.datetime(),
});
export type NegotiateUploadResponse = z.infer<typeof NegotiateUploadResponseSchema>;

export const CommitUploadSchema = z.object({
  uploadSessionId: z.guid(),
  contentHash: z.string().min(32).max(128).optional(),
  actualSizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
});
export type CommitUploadInput = z.infer<typeof CommitUploadSchema>;

export const CommitUploadResponseSchema = z.object({
  uploadSessionId: z.guid(),
  manifestId: z.guid(),
  state: z.literal('verifying'),
  rejectionReasonCode: z.string().optional(),
});
export type CommitUploadResponse = z.infer<typeof CommitUploadResponseSchema>;

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
