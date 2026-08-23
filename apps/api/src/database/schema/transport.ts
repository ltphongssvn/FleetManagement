// apps/api/src/database/schema/transport.ts
// Transport order + stop + road_run tables per Frozen Stack PDF "Domain model".
// T5 (2026): adds cancellation audit columns (cancelledAt/cancelledBy/
// cancellationReason/cancellationNote) and a DB-level check constraint that
// makes a 'cancelled' state without cancelled_at impossible. Check
// expressions use sql.raw(...) plain strings instead of tagged template
// literals so the file contains zero backticks (heredoc-safe edits).
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  integer,
  jsonb,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { TRANSPORT_ORDER_STATES, ROAD_RUN_STATES } from '@fleet/domain';
import { tenancyColumns } from './tenancy.js';

// Axis-2 (z.infer SSOT): the pgEnum vocabulary IS the domain Zod schema option
// tuple, never a copy of it. These arrays were previously hand-duplicated here
// under a comment claiming they mirror @fleet/domain -- a mirror is precisely
// the drift hazard: the DB enum and the domain FSM can diverge silently until
// Postgres rejects a state the app wrote. Guarded by
// test/transport-schema-enum-domain-ssot.test.ts (value equality IN ORDER plus
// a source scan that fails on re-inlining, since a re-copied array would still
// satisfy value equality).
//
// The STATES exports are frozen as-const tuples in @fleet/domain, which
// satisfy the Readonly<[U, ...U[]]> that pgEnum requires and preserve the
// literal union downstream. This mirrors manifest.ts, which imports its
// vocabularies the same way. Identical values and order => identical SQL =>
// no migration.
export const transportOrderStateEnum = pgEnum('transport_order_state', TRANSPORT_ORDER_STATES);
export const roadRunStateEnum = pgEnum('road_run_state', ROAD_RUN_STATES);

export const transportOrder = pgTable(
  'transport_order',
  {
    transportOrderId: uuid('transport_order_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    externalRef: varchar('external_ref', { length: 64 }),
    state: transportOrderStateEnum('state').notNull().default('draft'),
    customerId: uuid('customer_id'),
    cargoTypeId: uuid('cargo_type_id'),
    metadata: jsonb('metadata'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelledBy: uuid('cancelled_by'),
    cancellationReason: varchar('cancellation_reason', { length: 64 }),
    cancellationNote: varchar('cancellation_note', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('transport_order_state_idx').on(t.state),
    index('transport_order_company_idx').on(t.companyId),
    index('transport_order_external_ref_idx').on(t.externalRef),
    index('transport_order_cancelled_at_idx').on(t.cancelledAt),
    check('transport_order_updated_after_created', sql.raw('updated_at >= created_at')),
    check(
      'transport_order_cancelled_audit_consistent',
      sql.raw("state <> 'cancelled' OR cancelled_at IS NOT NULL"),
    ),
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
    check('stop_sequence_positive', sql.raw('sequence > 0')),
    check(
      'stop_departed_after_arrived',
      sql.raw('departed_at IS NULL OR arrived_at IS NULL OR departed_at >= arrived_at'),
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
      sql.raw('completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at'),
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
    check('rrto_sequence_positive', sql.raw('sequence > 0')),
  ],
);

export type TransportOrder = typeof transportOrder.$inferSelect;
export type NewTransportOrder = typeof transportOrder.$inferInsert;
export type Stop = typeof stop.$inferSelect;
export type NewStop = typeof stop.$inferInsert;
export type RoadRun = typeof roadRun.$inferSelect;
export type NewRoadRun = typeof roadRun.$inferInsert;
export type RoadRunTransportOrder = typeof roadRunTransportOrder.$inferSelect;
