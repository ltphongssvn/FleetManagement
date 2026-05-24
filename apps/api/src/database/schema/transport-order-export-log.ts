// apps/api/src/database/schema/transport-order-export-log.ts
//
// Ledger table proving the daily-backup invariant for the Lệnh điều xe
// Excel export feature (T1, 2026).
//
// Invariant enforced at DB level (last line of defense behind DTO + service):
//   - trigger MUST be one of 'manual','login','logout' (CHECK constraint)
//   - For auto triggers ('login','logout'), the tuple
//     (company_id, operator_id, day_key, trigger) is UNIQUE so duplicate
//     login/logout events on the same day cannot create duplicate rows.
//   - Manual exports are NOT subject to uniqueness — users may export
//     several times per day on demand.
//
// day_key is a varchar(10) holding the VN-timezone calendar date
// (YYYY-MM-DD). varchar (not DATE) keeps the unique-index key
// deterministic across server timezones — the service computes the
// VN-local day before insert. row_count + sha256 + filename are kept for
// audit/forensics: an auditor can re-render the worksheet at any time
// and prove the recorded sha256 matches.
import { pgTable, uuid, varchar, integer, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenancyColumns } from './tenancy.js';
export const transportOrderExportLog = pgTable(
  'transport_order_export_log',
  {
    exportLogId: uuid('export_log_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    operatorId: uuid('operator_id').notNull(),
    trigger: varchar('trigger', { length: 16 }).notNull(),
    dayKey: varchar('day_key', { length: 10 }).notNull(),
    rowCount: integer('row_count').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('toel_company_idx').on(t.companyId),
    index('toel_operator_day_idx').on(t.operatorId, t.dayKey),
    uniqueIndex('toel_auto_unique_per_day')
      .on(t.companyId, t.operatorId, t.dayKey, t.trigger)
      .where(sql.raw("trigger IN ('login','logout')")),
    check('toel_trigger_allowed', sql.raw("trigger IN ('manual','login','logout')")),
    check('toel_row_count_nonneg', sql.raw('row_count >= 0')),
  ],
);
export type TransportOrderExportLog = typeof transportOrderExportLog.$inferSelect;
export type NewTransportOrderExportLog = typeof transportOrderExportLog.$inferInsert;
