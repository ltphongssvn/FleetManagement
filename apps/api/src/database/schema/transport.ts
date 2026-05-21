// apps/api/src/database/schema/transport.ts
// Transport order + stop + road_run tables per Frozen Stack PDF "Domain model".
import { pgTable, uuid, varchar, timestamp, index, integer, jsonb, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenancyColumns } from './tenancy.js';

// pgEnum mirrors @fleet/domain TRANSPORT_ORDER_STATES — DB-level enforcement.
export const transportOrderStateEnum = pgEnum('transport_order_state', [
  'draft',
  'assigned',
  'in_transit',
  'completed',
  'cancelled',
]);

export const roadRunStateEnum = pgEnum('road_run_state', [
  'planned',
  'dispatched',
  'started',
  'completed',
  'cancelled',
]);

export const transportOrder = pgTable(
  'transport_order',
  {
    transportOrderId: uuid('transport_order_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    externalRef: varchar('external_ref', { length: 64 }),
    state: transportOrderStateEnum('state').notNull().default('draft'),
    customerId: uuid('customer_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('transport_order_state_idx').on(t.state),
    index('transport_order_company_idx').on(t.companyId),
    index('transport_order_external_ref_idx').on(t.externalRef),
    check('transport_order_updated_after_created', sql`${t.updatedAt} >= ${t.createdAt}`),
  ],
);

export const stop = pgTable(
  'stop',
  {
    stopId: uuid('stop_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    transportOrderId: uuid('transport_order_id')
      .notNull()
      .references(() => transportOrder.transportOrderId, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    stopType: varchar('stop_type', { length: 32 }).notNull(),
    yardId: uuid('yard_id'),
    address: jsonb('address'),
    plannedAt: timestamp('planned_at', { withTimezone: true, mode: 'date' }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true, mode: 'date' }),
    departedAt: timestamp('departed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('stop_transport_order_idx').on(t.transportOrderId),
    index('stop_yard_idx').on(t.yardId),
    check('stop_sequence_positive', sql`${t.sequence} > 0`),
    check(
      'stop_departed_after_arrived',
      sql`${t.departedAt} IS NULL OR ${t.arrivedAt} IS NULL OR ${t.departedAt} >= ${t.arrivedAt}`,
    ),
  ],
);

export const roadRun = pgTable(
  'road_run',
  {
    roadRunId: uuid('road_run_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    state: roadRunStateEnum('state').notNull().default('planned'),
    // 2026 invariant: every road_run is created with a bound driver + truck.
    // The DTO and service-layer pair guard already require these two uuids
    // and verify they reference an active driver_vehicle_assignment row.
    // The DB-level NOT NULL is the last line of defense: even if a future
    // bypass tried to insert a partial road_run, Postgres will reject it.
    assignedOperatorId: uuid('assigned_operator_id').notNull(),
    assignedAssetId: uuid('assigned_asset_id').notNull(),
    plannedStartAt: timestamp('planned_start_at', { withTimezone: true, mode: 'date' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('road_run_state_idx').on(t.state),
    index('road_run_operator_idx').on(t.assignedOperatorId),
    check(
      'road_run_completed_after_started',
      sql`${t.completedAt} IS NULL OR ${t.startedAt} IS NULL OR ${t.completedAt} >= ${t.startedAt}`,
    ),
  ],
);

export const roadRunTransportOrder = pgTable(
  'road_run_transport_order',
  {
    roadRunTransportOrderId: uuid('road_run_transport_order_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    roadRunId: uuid('road_run_id')
      .notNull()
      .references(() => roadRun.roadRunId, { onDelete: 'cascade' }),
    transportOrderId: uuid('transport_order_id')
      .notNull()
      .references(() => transportOrder.transportOrderId, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
  },
  (t) => [
    index('rrto_road_run_idx').on(t.roadRunId),
    index('rrto_transport_order_idx').on(t.transportOrderId),
    check('rrto_sequence_positive', sql`${t.sequence} > 0`),
  ],
);

export type TransportOrder = typeof transportOrder.$inferSelect;
export type NewTransportOrder = typeof transportOrder.$inferInsert;
export type Stop = typeof stop.$inferSelect;
export type NewStop = typeof stop.$inferInsert;
export type RoadRun = typeof roadRun.$inferSelect;
export type NewRoadRun = typeof roadRun.$inferInsert;
export type RoadRunTransportOrder = typeof roadRunTransportOrder.$inferSelect;
