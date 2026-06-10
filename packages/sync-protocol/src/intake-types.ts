// packages/sync-protocol/src/intake-types.ts
// Wire types + Zod schema for the 'intake' BullMQ queue per Frozen Stack PDF
// "@sync-protocol — wire types". Shared by API (enqueue) and worker (consume)
// to prevent schema drift across the API/worker boundary — the same pattern as
// erp-types.ts. This is the BODY the relay enqueues after stripping the outbox
// routing envelope ({aggregateType, eventType}); it must match what the worker's
// queue-router parses for the intake queue.
//
// actual*/hash/virusScanClean are nullable because the API enqueues them as null
// at request time; the worker fills them in during S3 HEAD + hash + scan.
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES } from './manifest-types.js';

const IntakeManifestMimeSchema = z.enum(ALLOWED_MANIFEST_MIME_TYPES as unknown as [string, ...string[]]);

export const IntakeJobDataWireSchema = z.object({
  manifestId: z.string().uuid(),
  uploadSessionId: z.string().uuid(),
  s3Key: z.string().min(1).max(512),
  s3Bucket: z.string().min(1).max(128),
  expectedContentType: IntakeManifestMimeSchema,
  expectedSizeBytes: z.number().int().positive(),
  maxSizeBytes: z.number().int().positive(),
  actualContentType: z.union([IntakeManifestMimeSchema, z.null()]),
  actualSizeBytes: z.union([z.number().int().nonnegative(), z.null()]),
  providedHash: z.union([z.string().min(1), z.null()]),
  computedHash: z.union([z.string().min(1), z.null()]),
  virusScanClean: z.union([z.boolean(), z.null()]),
}).strict();

export type IntakeJobDataWire = z.infer<typeof IntakeJobDataWireSchema>;
