// apps/api/src/database/schema/manifest.ts
// Manifest + upload_session tables per Frozen Stack PDF "Manifest" + "Uploads".
import { pgTable, uuid, varchar, timestamp, index, integer, jsonb, numeric, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenancyColumns } from './tenancy.js';
import { transportOrder, stop } from './transport.js';

export const uploadSessionStateEnum = pgEnum('upload_session_state', [
  'initiated',
  'uploading',
  'verifying',
  'committed',
  'rejected',
  'aborted',
]);

export const manifestRejectionReasonEnum = pgEnum('manifest_rejection_reason', [
  'blurred_image',
  'wrong_manifest',
  'missing_page',
  'oversized_file',
  'unsupported_format',
  'duplicate_upload',
  'hash_mismatch',
  'virus_detected',
  'other',
]);

export const manifestStateEnum = pgEnum('manifest_state', [
  'pending',
  'verifying',
  'captured',
  'committed',
  'rejected',
]);

// Phieu-can net-weight extraction status (SSOT vocabulary in
// @fleet/domain manifestExtractionStatusSchema). Persisted on EVERY worker
// outcome (incl. not_found/unreadable) so the board can tell "processing"
// (pending) from "needs entry" (not_found/unreadable) from a value
// (extracted/manual) — closes the silent-failure gap. Expand-only: default
// 'pending' backfills existing rows.
export const manifestExtractionStatusEnum = pgEnum('manifest_extraction_status', [
  'pending',
  'extracted',
  'not_found',
  'unreadable',
  'manual',
]);
// Deterministic cause of a non-extracted outcome (SSOT vocabulary in
// @fleet/sync-protocol EXTRACTION_FAILURE_REASONS). Nullable: only set for
// not_found/unreadable rows so a parse refusal ('unparseable') is queryably
// distinct from an illegible photo ('object_missing') for the review queue.
// Expand-only; null for pending/extracted/manual.
export const manifestExtractionReasonEnum = pgEnum('manifest_extraction_reason', [
  'unparseable',
  'below_sanity_min',
  'above_sanity_max',
  'no_field',
  'object_missing',
]);

export const manifest = pgTable(
  'manifest',
  {
    manifestId: uuid('manifest_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    transportOrderId: uuid('transport_order_id')
      .notNull()
      .references(() => transportOrder.transportOrderId, { onDelete: 'cascade' }),
    /** UUIDv7 client-generated per PDF "Correlation IDs" */
    manifestCorrelationId: uuid('manifest_correlation_id').notNull().unique(),
    /** Stop this proof photo documents (captured-time association; explicit
     *  reference, never inferred). Nullable: pre-existing manifests + the brief
     *  window before the driver-app sends it. set null on stop delete so proof
     *  survives stop edits. */
    stopId: uuid('stop_id').references(() => stop.stopId, { onDelete: 'set null' }),
    state: manifestStateEnum('state').notNull().default('pending'),
    capturedByOperatorId: uuid('captured_by_operator_id'),
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }),
    committedAt: timestamp('committed_at', { withTimezone: true, mode: 'date' }),
    rejectionReasonCode: manifestRejectionReasonEnum('rejection_reason_code'),
    rejectionReasonText: varchar('rejection_reason_text', { length: 500 }),
    /** EXPAND-only (phieu-can net-weight extraction): net goods weight in kg
     *  parsed from the committed Phieu Can by the extraction worker; null until
     *  extraction succeeds. numeric(12,3) via VLM, never trusted unvalidated. */
    extractedNetWeightKg: numeric('extracted_net_weight_kg', { precision: 12, scale: 3 }),
    /** Extraction lifecycle status (see manifestExtractionStatusEnum). Default
     *  'pending'; the worker callback sets extracted/not_found/unreadable, a
     *  dispatcher's manual edit sets 'manual'. */
    extractionStatus: manifestExtractionStatusEnum('extraction_status').notNull().default('pending'),
    /** EXPAND-only: deterministic failure cause for not_found/unreadable rows
     *  (see manifestExtractionReasonEnum). Null for pending/extracted/manual. */
    extractionReason: manifestExtractionReasonEnum('extraction_reason'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('manifest_transport_order_idx').on(t.transportOrderId),
    index('manifest_state_idx').on(t.state),
    index('manifest_stop_idx').on(t.stopId),
  ],
);

export const uploadSession = pgTable(
  'upload_session',
  {
    uploadSessionId: uuid('upload_session_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    manifestId: uuid('manifest_id').references(() => manifest.manifestId, { onDelete: 'cascade' }),
    operatorId: uuid('operator_id').notNull(),
    s3Key: varchar('s3_key', { length: 512 }).notNull(),
    s3Bucket: varchar('s3_bucket', { length: 128 }).notNull(),
    contentType: varchar('content_type', { length: 128 }).notNull(),
    expectedSizeBytes: integer('expected_size_bytes'),
    actualSizeBytes: integer('actual_size_bytes'),
    state: uploadSessionStateEnum('state').notNull().default('initiated'),
    contentHash: varchar('content_hash', { length: 128 }),
    initiatedAt: timestamp('initiated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true, mode: 'date' }),
    abortedAt: timestamp('aborted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('upload_session_manifest_idx').on(t.manifestId),
    index('upload_session_operator_idx').on(t.operatorId),
    index('upload_session_state_idx').on(t.state),
    check('upload_session_size_positive', sql`${t.expectedSizeBytes} IS NULL OR ${t.expectedSizeBytes} > 0`),
  ],
);

export type Manifest = typeof manifest.$inferSelect;
export type NewManifest = typeof manifest.$inferInsert;
export type UploadSession = typeof uploadSession.$inferSelect;
export type NewUploadSession = typeof uploadSession.$inferInsert;
