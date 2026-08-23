// apps/api/src/database/schema/manifest.ts
// Manifest + upload_session tables per Frozen Stack PDF "Manifest" + "Uploads".
// Enum vocabularies are imported from their @fleet/domain and
// @fleet/sync-protocol SSOTs (schema-first, fix-trigger 2: the state and
// reason arrays were previously hand-duplicated here). pgEnum accepts the
// as-const tuples directly and emits identical SQL, so this is a pure
// source-dedup with zero migration.
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  UPLOAD_SESSION_STATES,
  MANIFEST_STATES,
  MANIFEST_REJECTION_REASONS,
  MANIFEST_EXTRACTION_STATUSES,
} from '@fleet/domain';
import { EXTRACTION_FAILURE_REASONS } from '@fleet/sync-protocol';
import { tenancyColumns } from './tenancy.js';
import { transportOrder, stop } from './transport.js';
export const uploadSessionStateEnum = pgEnum('upload_session_state', UPLOAD_SESSION_STATES);
export const manifestRejectionReasonEnum = pgEnum(
  'manifest_rejection_reason',
  MANIFEST_REJECTION_REASONS,
);
export const manifestStateEnum = pgEnum('manifest_state', MANIFEST_STATES);
// Phieu-can net-weight extraction status (SSOT @fleet/domain
// MANIFEST_EXTRACTION_STATUSES). Persisted on EVERY worker outcome (incl.
// not_found/unreadable) so the board can tell processing (pending) from
// needs-entry (not_found/unreadable) from a value (extracted/manual).
// Expand-only: default pending backfills existing rows.
export const manifestExtractionStatusEnum = pgEnum(
  'manifest_extraction_status',
  MANIFEST_EXTRACTION_STATUSES,
);
// Deterministic cause of a non-extracted outcome (SSOT @fleet/sync-protocol
// EXTRACTION_FAILURE_REASONS). Nullable: only set for not_found/unreadable
// rows so a parse refusal (unparseable) is queryably distinct from an
// illegible photo (object_missing). Expand-only; null for
// pending/extracted/manual.
export const manifestExtractionReasonEnum = pgEnum(
  'manifest_extraction_reason',
  EXTRACTION_FAILURE_REASONS,
);
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
    // Intake reconciler (T9, 2026-07-11): persisted retry bookkeeping for the
    // self-healing loop. Attempts NEVER reset on restart (anti-pattern); the
    // reconciler gates re-emission by exponential backoff off
    // lastIntakeReconcileAt and quarantines in place at max attempts (rows
    // stay verifying; manual intake:redrive is the deliberate post-fix replay
    // and ignores this gate).
    intakeReconcileAttempts: integer('intake_reconcile_attempts').notNull().default(0),
    lastIntakeReconcileAt: timestamp('last_intake_reconcile_at', {
      withTimezone: true,
      mode: 'date',
    }),
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
     *  pending; the worker callback sets extracted/not_found/unreadable, a
     *  dispatcher manual edit sets manual. */
    extractionStatus: manifestExtractionStatusEnum('extraction_status')
      .notNull()
      .default('pending'),
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
    initiatedAt: timestamp('initiated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true, mode: 'date' }),
    abortedAt: timestamp('aborted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('upload_session_manifest_idx').on(t.manifestId),
    index('upload_session_operator_idx').on(t.operatorId),
    index('upload_session_state_idx').on(t.state),
    check(
      'upload_session_size_positive',
      sql`${t.expectedSizeBytes} IS NULL OR ${t.expectedSizeBytes} > 0`,
    ),
  ],
);
export type Manifest = typeof manifest.$inferSelect;
export type NewManifest = typeof manifest.$inferInsert;
export type UploadSession = typeof uploadSession.$inferSelect;
export type NewUploadSession = typeof uploadSession.$inferInsert;
