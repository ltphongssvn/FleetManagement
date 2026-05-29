// apps/driver-app/src/storage/schema.ts
// Drizzle schema for driver-app local SQLite store per Frozen Stack PDF.
// Day-one tables: local_action_log (FIFO per aggregate) + sync_cursor.
import { sqliteTable, text, integer, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ActionId, AggregateId } from '@fleet/sync-protocol';

const ACTION_STATUSES = ['pending', 'syncing', 'synced', 'rejected', 'superseded'] as const;

export const localActionLog = sqliteTable(
  'local_action_log',
  {
    actionId: text('action_id').$type<ActionId>().primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').$type<AggregateId>().notNull(),
    sequence: integer('sequence').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    // DB-level enum enforcement (drizzle text({enum:[...]}) emits CHECK constraint).
    status: text('status', { enum: ACTION_STATUSES }).notNull().default('pending'),
    // 1-level only by design per ADR-003.
    blockedByActionId: text('blocked_by_action_id').$type<ActionId>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    // FIFO invariant: at most one row per (aggregate_type, aggregate_id, sequence).
    uniqueIndex('local_action_log_aggregate_sequence_uq').on(
      t.aggregateType,
      t.aggregateId,
      t.sequence,
    ),
    check('local_action_log_sequence_positive', sql`${t.sequence} > 0`),
  ],
);

export const syncCursor = sqliteTable(
  'sync_cursor',
  {
    id: integer('id').primaryKey().default(1),
    cursor: text('cursor').notNull(),
    lastSeenSeq: integer('last_seen_seq').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [check('sync_cursor_singleton', sql`${t.id} = 1`)],
);

export type LocalAction = typeof localActionLog.$inferSelect;
export type NewLocalAction = typeof localActionLog.$inferInsert;
export type SyncCursorRow = typeof syncCursor.$inferSelect;
