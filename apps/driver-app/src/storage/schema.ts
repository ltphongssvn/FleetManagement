// apps/driver-app/src/storage/schema.ts
// Drizzle schema for driver-app local SQLite store per Frozen Stack PDF.
// Day-one tables: local_action_log (FIFO per aggregate) + sync_cursor.
// Additional tables (assigned_road_runs, manifest_drafts, capture_spool index,
// bootstrap_session, etc.) land in week 3+ as features come online.
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const localActionLog = sqliteTable('local_action_log', {
  // UUIDv7 client-generated per PDF "Correlation IDs"
  actionId: text('action_id').primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  // FIFO ordering within aggregate; monotonically incremented at enqueue
  sequence: integer('sequence').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  // Status: 'pending' | 'syncing' | 'synced' | 'rejected' | 'superseded'
  status: text('status').notNull().default('pending'),
  // upload-to-sync chaining per PDF: blocked_by_action_id for upload->sync only
  blockedByActionId: text('blocked_by_action_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
});

export const syncCursor = sqliteTable('sync_cursor', {
  // Single-row table; constant id keeps upserts simple
  id: integer('id').primaryKey().default(1),
  cursor: text('cursor').notNull(),
  lastSeenSeq: integer('last_seen_seq').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type LocalAction = typeof localActionLog.$inferSelect;
export type NewLocalAction = typeof localActionLog.$inferInsert;
export type SyncCursorRow = typeof syncCursor.$inferSelect;
