// apps/api/src/database/schema/append-paths.ts
// Three append paths in same tx per Frozen Stack PDF:
// fleet_audit_log + sync_change_feed + outbox.
// Monotonic gap-tolerant server_seq bigint; Postgres uniqueness on action_id.
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  bigint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';

export const fleetAuditLog = pgTable(
  'fleet_audit_log',
  {
    auditId: uuid('audit_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    serverSeq: bigint('server_seq', { mode: 'bigint' }).notNull(),
    operatorId: uuid('operator_id'),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // PDF: indexed on (operator_id, event_type, created_at) for suppressed-evidence queries
    index('fleet_audit_log_operator_event_time_idx').on(t.operatorId, t.eventType, t.createdAt),
    index('fleet_audit_log_aggregate_idx').on(t.aggregateType, t.aggregateId),
  ],
);

export const syncChangeFeed = pgTable(
  'sync_change_feed',
  {
    feedId: uuid('feed_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    serverSeq: bigint('server_seq', { mode: 'bigint' }).notNull(),
    actionId: uuid('action_id').notNull(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    delta: jsonb('delta').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sync_change_feed_action_id_uq').on(t.actionId),
    index('sync_change_feed_seq_idx').on(t.serverSeq),
  ],
);

export const outbox = pgTable(
  'outbox',
  {
    outboxId: uuid('outbox_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    queueName: varchar('queue_name', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attempts: bigint('attempts', { mode: 'number' }).notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('outbox_status_next_attempt_idx').on(t.status, t.nextAttemptAt),
    index('outbox_queue_idx').on(t.queueName),
  ],
);

export type FleetAuditLog = typeof fleetAuditLog.$inferSelect;
export type SyncChangeFeed = typeof syncChangeFeed.$inferSelect;
export type Outbox = typeof outbox.$inferSelect;
