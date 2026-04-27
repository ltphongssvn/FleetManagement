// apps/driver-app/src/storage/schema.ts
// Drizzle schema for driver-app local SQLite store per Frozen Stack PDF.
// Day-one tables: local_action_log (FIFO per aggregate) + sync_cursor.
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { ActionId, AggregateId } from '@fleet/sync-protocol';
import type { ActionStatus } from './action-queue-policy.js';

export const localActionLog = sqliteTable('local_action_log', {
  // UUIDv7 client-generated per PDF "Correlation IDs"
  actionId: text('action_id').$type<ActionId>().primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').$type<AggregateId>().notNull(),
  // FIFO ordering within aggregate; monotonically incremented at enqueue
  sequence: integer('sequence').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  // PDF-mandated lifecycle states (compile-time enforced via $type)
  status: text('status').$type<ActionStatus>().notNull().default('pending'),
  // upload-to-sync chaining per PDF: blocked_by_action_id for upload->sync only.
  // 1-level only by design: upload actions have no blocker; only sync actions
  // reference their upload's id. No transitive chain exists in the data model.
  // See docs/adr/003-action-queue-1-level-blocking.md
  blockedByActionId: text('blocked_by_action_id').$type<ActionId>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
});

export const syncCursor = sqliteTable('sync_cursor', {
  id: integer('id').primaryKey().default(1),
  cursor: text('cursor').notNull(),
  lastSeenSeq: integer('last_seen_seq').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type LocalAction = typeof localActionLog.$inferSelect;
export type NewLocalAction = typeof localActionLog.$inferInsert;
export type SyncCursorRow = typeof syncCursor.$inferSelect;
