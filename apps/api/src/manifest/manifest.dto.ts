// apps/api/src/manifest/manifest.dto.ts
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES } from '@fleet/sync-protocol';

export const NegotiateUploadSchema = z.object({
  manifestCorrelationId: z.string().uuid(),
  transportOrderId: z.string().uuid(),
  contentType: z.enum(ALLOWED_MANIFEST_MIME_TYPES),
  expectedSizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
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
