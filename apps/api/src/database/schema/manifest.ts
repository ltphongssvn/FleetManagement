// apps/api/src/database/schema/manifest.ts
// Manifest + upload_session tables per Frozen Stack PDF "Manifest" + "Uploads".
import { pgTable, uuid, varchar, timestamp, index, integer, jsonb, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenancyColumns } from './tenancy.js';
import { transportOrder } from './transport.js';

export const uploadSessionStateEnum = pgEnum('upload_session_state', [
  'initiated',
  'uploading',
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
  'captured',
  'committed',
  'rejected',
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
    state: manifestStateEnum('state').notNull().default('pending'),
    capturedByOperatorId: uuid('captured_by_operator_id'),
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }),
    committedAt: timestamp('committed_at', { withTimezone: true, mode: 'date' }),
    rejectionReasonCode: manifestRejectionReasonEnum('rejection_reason_code'),
    rejectionReasonText: varchar('rejection_reason_text', { length: 500 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('manifest_transport_order_idx').on(t.transportOrderId),
    index('manifest_state_idx').on(t.state),
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
