// packages/sync-protocol/src/extraction-types.ts
// Wire types + Zod schemas for the 'extraction' BullMQ queue AND the
// /upload/extraction-result callback. Shared by API (enqueue + consume result)
// and worker (consume job + produce result) to prevent schema drift across the
// boundary — same pattern as intake-types.ts, EXTENDED so the callback body is
// also SSOT here (intake's callback schema is API-local; do not copy that gap).
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES } from './manifest-types.js';
import { netWeightKgSchema } from './dispatch-stop-view-contract.js';
import { EXTRACTION_FAILURE_REASONS, type ExtractionFailureReason } from './extraction-vocabulary.js';

const ExtractionMimeSchema = z.enum(ALLOWED_MANIFEST_MIME_TYPES as unknown as [string, ...string[]]);

/** Queue body enqueued by the outbox relay for manifest_extraction.requested. */
export const ExtractionJobDataWireSchema = z.object({
  manifestId: z.guid(),
  uploadSessionId: z.guid(),
  s3Key: z.string().min(1).max(512),
  s3Bucket: z.string().min(1).max(128),
  contentType: ExtractionMimeSchema,
}).strict();
export type ExtractionJobDataWire = z.infer<typeof ExtractionJobDataWireSchema>;

export const EXTRACTION_STATUSES = ['extracted', 'not_found', 'unreadable'] as const;
export type ExtractionStatus = typeof EXTRACTION_STATUSES[number];

// Failure-reason vocabulary is the LEAF SSOT in extraction-vocabulary.ts
// (imported above and re-exported here for back-compat with existing
// importers of this module). Extracted to a leaf to break the import cycle
// with dispatch-stop-view-contract.ts, which also needs the reasons.
export { EXTRACTION_FAILURE_REASONS, type ExtractionFailureReason };

/** POST /upload/extraction-result body. kg is present iff status==='extracted';
 *  reason is present iff status!=='extracted'. kg is parser-normalized:
 *  Vietnamese thousands-separator already resolved ('20.730 Kg' -> 20730). */
export const ExtractionResultWireSchema = z.object({
  manifestId: z.guid(),
  status: z.enum(EXTRACTION_STATUSES),
  extractedNetWeightKg: z.union([netWeightKgSchema, z.null()]),
  reason: z.enum(EXTRACTION_FAILURE_REASONS).optional(),
}).strict()
  .refine(
    (v) => (v.status === 'extracted') === (v.extractedNetWeightKg !== null),
    { message: 'extractedNetWeightKg must be non-null iff status is extracted' },
  )
  .refine(
    (v) => (v.status !== 'extracted') === (v.reason !== undefined),
    { message: 'reason must be present iff status is not extracted' },
  );
export type ExtractionResultWire = z.infer<typeof ExtractionResultWireSchema>;
