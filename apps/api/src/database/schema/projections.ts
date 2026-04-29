// apps/api/src/database/schema/projections.ts
// Read-side projection tables per Frozen Stack PDF "projection_status table
// keyed by (projection_name, scope) with watermark, lag_ms, last_rebuilt_at"
// + Day-One #7 "RSC reads from dispatch_board_projection".
import { pgTable, uuid, varchar, timestamp, index, integer, jsonb, bigint, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenancyColumns } from './tenancy.js';
import { roadRunStateEnum } from './transport.js';

/**
 * Read-model row materialized by the projection runner from sync_change_feed
 * events for road_run aggregates. Consumed by ops-web RSC dispatch board.
 */
export const dispatchBoardProjection = pgTable(
  'dispatch_board_projection',
  {
    roadRunId: uuid('road_run_id').primaryKey(),
    ...tenancyColumns,
    state: roadRunStateEnum('state').notNull(),
    assignedOperatorId: uuid('assigned_operator_id'),
    assignedAssetId: uuid('assigned_asset_id'),
    plannedStartAt: timestamp('planned_start_at', { withTimezone: true, mode: 'date' }),
    stopCount: integer('stop_count').notNull().default(0),
    transportOrderRefs: jsonb('transport_order_refs').$type<readonly string[]>().notNull().default([]),
    /** server_seq of the latest event applied to this row (monotonic). */
    serverSeq: bigint('server_seq', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('dispatch_board_projection_state_idx').on(t.state),
    index('dispatch_board_projection_company_idx').on(t.companyId),
    index('dispatch_board_projection_planned_start_idx').on(t.plannedStartAt),
    check('dispatch_board_projection_stop_count_nonneg', sql`${t.stopCount} >= 0`),
    check('dispatch_board_projection_server_seq_nonneg', sql`${t.serverSeq} >= 0`),
  ],
);

/**
 * Per-projection watermark + freshness telemetry. PDF: "projection_status table
 * keyed by (projection_name, scope) with watermark, lag_ms, last_rebuilt_at".
 * scope = company_id (pilot) or wider key for multi-tenant.
 */
export const projectionStatus = pgTable(
  'projection_status',
  {
    projectionName: varchar('projection_name', { length: 64 }).notNull(),
    scope: varchar('scope', { length: 128 }).notNull(),
    /** Highest server_seq successfully applied to this projection. */
    watermark: bigint('watermark', { mode: 'bigint' }).notNull().default(sql`0`),
    lagMs: integer('lag_ms').notNull().default(0),
    lastRebuiltAt: timestamp('last_rebuilt_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'projection_status_pkey', columns: [t.projectionName, t.scope] }),
    check('projection_status_watermark_nonneg', sql`${t.watermark} >= 0`),
    check('projection_status_lag_ms_nonneg', sql`${t.lagMs} >= 0`),
  ],
);

export type DispatchBoardProjection = typeof dispatchBoardProjection.$inferSelect;
export type NewDispatchBoardProjection = typeof dispatchBoardProjection.$inferInsert;
export type ProjectionStatus = typeof projectionStatus.$inferSelect;
export type NewProjectionStatus = typeof projectionStatus.$inferInsert;
