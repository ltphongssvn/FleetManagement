// apps/api/src/manifest/manifest.dto.ts
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES, ManifestStopRefSchema } from '@fleet/sync-protocol';

export const NegotiateUploadSchema = z.object({
  manifestCorrelationId: z.string().uuid(),
  transportOrderId: z.string().uuid(),
  contentType: z.enum(ALLOWED_MANIFEST_MIME_TYPES),
  expectedSizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  // Capture-time stop ref (Phiếu Cân association) — ManifestStopRefSchema from
  // @fleet/sync-protocol (Zod-first SSOT). EXPAND-only: absent/null for older
  // clients; when present the service resolves + persists manifest.stop_id.
  stop: ManifestStopRefSchema.nullish(),
});
export type NegotiateUploadInput = z.infer<typeof NegotiateUploadSchema>;

export const NegotiateUploadResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  url: z.string().url(),
  key: z.string(),
  bucket: z.string(),
  expiresAt: z.string().datetime(),
});
export type NegotiateUploadResponse = z.infer<typeof NegotiateUploadResponseSchema>;

export const CommitUploadSchema = z.object({
  uploadSessionId: z.string().uuid(),
  contentHash: z.string().min(32).max(128).optional(),
  actualSizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
});
export type CommitUploadInput = z.infer<typeof CommitUploadSchema>;

export const CommitUploadResponseSchema = z.object({
  uploadSessionId: z.string().uuid(),
  manifestId: z.string().uuid(),
  state: z.literal('verifying'),
  rejectionReasonCode: z.string().optional(),
});
export type CommitUploadResponse = z.infer<typeof CommitUploadResponseSchema>;
