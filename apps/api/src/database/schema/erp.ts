// apps/api/src/database/schema/erp.ts
// ERP mapping tables per Frozen Stack PDF "ERP" + Day-One feature 8.
import { pgTable, uuid, varchar, timestamp, index, jsonb, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';

export const erpSyncDirectionEnum = pgEnum('erp_sync_direction', ['outbound', 'inbound']);
export const erpSyncStatusEnum = pgEnum('erp_sync_status', ['pending', 'sent', 'acknowledged', 'failed']);

export const erpCustomerMap = pgTable(
  'erp_customer_map',
  {
    erpCustomerMapId: uuid('erp_customer_map_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    internalCustomerId: uuid('internal_customer_id').notNull(),
    externalErpId: varchar('external_erp_id', { length: 128 }).notNull(),
    erpSystem: varchar('erp_system', { length: 64 }).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('erp_customer_map_internal_idx').on(t.internalCustomerId),
    index('erp_customer_map_external_idx').on(t.externalErpId),
    uniqueIndex('erp_customer_map_internal_uq').on(t.companyId, t.erpSystem, t.internalCustomerId),
    uniqueIndex('erp_customer_map_external_uq').on(t.companyId, t.erpSystem, t.externalErpId),
  ],
);

export const erpJobCodeMap = pgTable(
  'erp_job_code_map',
  {
    erpJobCodeMapId: uuid('erp_job_code_map_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    internalJobCode: varchar('internal_job_code', { length: 64 }).notNull(),
    externalErpCode: varchar('external_erp_code', { length: 128 }).notNull(),
    erpSystem: varchar('erp_system', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('erp_job_code_map_internal_idx').on(t.internalJobCode),
    index('erp_job_code_map_external_idx').on(t.externalErpCode),
    uniqueIndex('erp_job_code_map_internal_uq').on(t.companyId, t.erpSystem, t.internalJobCode),
    uniqueIndex('erp_job_code_map_external_uq').on(t.companyId, t.erpSystem, t.externalErpCode),
  ],
);

export const erpInvoiceMap = pgTable(
  'erp_invoice_map',
  {
    erpInvoiceMapId: uuid('erp_invoice_map_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    /** UUIDv7 client-generated per PDF "Correlation IDs" */
    manifestCorrelationId: uuid('manifest_correlation_id').notNull(),
    transportOrderId: uuid('transport_order_id').notNull(),
    externalErpInvoiceId: varchar('external_erp_invoice_id', { length: 128 }),
    erpSystem: varchar('erp_system', { length: 64 }).notNull(),
    direction: erpSyncDirectionEnum('direction').notNull().default('outbound'),
    status: erpSyncStatusEnum('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    failureReason: varchar('failure_reason', { length: 256 }),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('erp_invoice_map_correlation_idx').on(t.manifestCorrelationId),
    index('erp_invoice_map_transport_order_idx').on(t.transportOrderId),
    index('erp_invoice_map_status_idx').on(t.status),
    uniqueIndex('erp_invoice_map_idempotency_uq').on(t.manifestCorrelationId, t.erpSystem),
  ],
);

export type ErpCustomerMap = typeof erpCustomerMap.$inferSelect;
export type NewErpCustomerMap = typeof erpCustomerMap.$inferInsert;
export type ErpJobCodeMap = typeof erpJobCodeMap.$inferSelect;
export type NewErpJobCodeMap = typeof erpJobCodeMap.$inferInsert;
export type ErpInvoiceMap = typeof erpInvoiceMap.$inferSelect;
export type NewErpInvoiceMap = typeof erpInvoiceMap.$inferInsert;
