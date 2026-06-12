// packages/sync-protocol/src/extraction-types.ts
// Wire types + Zod schemas for the 'extraction' BullMQ queue AND the
// /upload/extraction-result callback. Shared by API (enqueue + consume result)
// and worker (consume job + produce result) to prevent schema drift across the
// boundary — same pattern as intake-types.ts, EXTENDED so the callback body is
// also SSOT here (intake's callback schema is API-local; do not copy that gap).
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES } from './manifest-types.js';

const ExtractionMimeSchema = z.enum(ALLOWED_MANIFEST_MIME_TYPES as unknown as [string, ...string[]]);

/** Queue body enqueued by the outbox relay for manifest_extraction.requested. */
export const ExtractionJobDataWireSchema = z.object({
  manifestId: z.string().uuid(),
  uploadSessionId: z.string().uuid(),
  s3Key: z.string().min(1).max(512),
  s3Bucket: z.string().min(1).max(128),
  contentType: ExtractionMimeSchema,
}).strict();
export type ExtractionJobDataWire = z.infer<typeof ExtractionJobDataWireSchema>;

export const EXTRACTION_STATUSES = ['extracted', 'not_found', 'unreadable'] as const;
export type ExtractionStatus = typeof EXTRACTION_STATUSES[number];

/** POST /upload/extraction-result body. kg is present iff status==='extracted';
 *  parser-normalized: Vietnamese thousands-separator already resolved
 *  ('20.730 Kg' on the phieu can -> 20730). */
export const ExtractionResultWireSchema = z.object({
  manifestId: z.string().uuid(),
  status: z.enum(EXTRACTION_STATUSES),
  extractedNetWeightKg: z.union([z.number().positive(), z.null()]),
}).strict().refine(
  (v) => (v.status === 'extracted') === (v.extractedNetWeightKg !== null),
  { message: 'extractedNetWeightKg must be non-null iff status is extracted' },
);
export type ExtractionResultWire = z.infer<typeof ExtractionResultWireSchema>;
