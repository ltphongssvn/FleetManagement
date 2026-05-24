// workers/main-worker/src/intake/intake-job.ts
// Wire shape + Zod runtime schema for jobs queued onto the 'intake' BullMQ queue.
// Schema enforced at the queue boundary (BullMQ Worker callback in main.ts) so
// the IntakeProcessor stays a pure function over a validated value object.
// Mirrors apps/api zod-at-the-boundary pattern (see apps/api/src/**/*.dto.ts).
import { z } from 'zod';
import { ALLOWED_MANIFEST_MIME_TYPES } from '@fleet/sync-protocol';

const ManifestMimeSchema = z.enum(ALLOWED_MANIFEST_MIME_TYPES as unknown as [string, ...string[]]);

export const IntakeJobDataSchema = z.object({
  manifestId: z.string().uuid(),
  uploadSessionId: z.string().uuid(),
  expectedContentType: ManifestMimeSchema,
  expectedSizeBytes: z.number().int().positive(),
  maxSizeBytes: z.number().int().positive(),
  actualContentType: z.union([ManifestMimeSchema, z.null()]),
  actualSizeBytes: z.union([z.number().int().nonnegative(), z.null()]),
  providedHash: z.union([z.string().min(1), z.null()]),
  computedHash: z.union([z.string().min(1), z.null()]),
  virusScanClean: z.union([z.boolean(), z.null()]),
}).strict();

export type IntakeJobData = z.infer<typeof IntakeJobDataSchema>;
