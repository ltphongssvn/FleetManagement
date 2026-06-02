// apps/api/src/database/schema/driver-password-reset-log.ts
//
// Audit ledger for service-desk (admin) driver password resets (2026).
// Per password-reset best practice, every manual/admin reset MUST be
// audit-logged: who performed it, on whom, and when. This table is the
// forensic record — one row per reset. It deliberately stores NO password
// material (not even a hash): the hash lives on the driver row; this ledger
// only proves the reset event happened and attributes it.
//
// Columns:
//   - actor_operator_id: the admin/dispatcher (JWT operatorId) who reset
//   - target_driver_id:  the driver whose credential was reset
//   - created_at:        when (defaultNow, tz-aware)
// Tenancy columns scope every query so cross-tenant reads are impossible.
import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';
export const driverPasswordResetLog = pgTable(
  'driver_password_reset_log',
  {
    resetLogId: uuid('reset_log_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    actorOperatorId: uuid('actor_operator_id').notNull(),
    targetDriverId: uuid('target_driver_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('dprl_company_idx').on(t.companyId),
    index('dprl_target_idx').on(t.targetDriverId),
    index('dprl_actor_idx').on(t.actorOperatorId),
  ],
);
export type DriverPasswordResetLog = typeof driverPasswordResetLog.$inferSelect;
export type NewDriverPasswordResetLog = typeof driverPasswordResetLog.$inferInsert;
