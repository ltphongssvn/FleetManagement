// apps/api/src/database/schema/reference.ts
// Reference master tables for dispatch form dropdowns: drivers, vehicles,
// customers, cargo types, warehouses. Seeded from VẬN CHUYỂN Xe Thùng PDFs.
import { pgTable, uuid, varchar, timestamp, index, integer, boolean, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenancyColumns } from './tenancy.js';

export const driver = pgTable(
  'driver',
  {
    driverId: uuid('driver_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    fullName: varchar('full_name', { length: 200 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    passwordHash: varchar('password_hash', { length: 128 }),
    operatorId: uuid('operator_id'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('driver_company_idx').on(t.companyId),
    // Driver name uniqueness is case-INSENSITIVE but accent-SENSITIVE: LÊ VĂN
    // CHÂU == Lê Văn Châu (same driver) yet LÊ != LE (different people). A plain
    // UNIQUE(company_id, full_name) is case-sensitive, so it let case-variant
    // duplicates through; lower(full_name) folds case without stripping accents
    // (unlike unaccent/citext) and keeps the column plain text so board/export
    // ILIKE search still works (a nondeterministic collation would break ILIKE
    // pre-PG18). PARTIAL on active rows only -- mirrors dva_one_active_per_*_uq
    // and the soft-delete convention: a soft-deleted row (active=false) never
    // blocks re-registration, so the one prod case-variant (a soft-deleted twin)
    // coexists without a destructive data migration.
    uniqueIndex('driver_company_active_name_ci_uq')
      .on(t.companyId, sql`lower(${t.fullName})`)
      .where(sql`active = true`),
    unique('driver_company_phone_uq').on(t.companyId, t.phone),
  ],
);

export const vehicle = pgTable(
  'vehicle',
  {
    vehicleId: uuid('vehicle_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    plate: varchar('plate', { length: 32 }).notNull(),
    vehicleType: varchar('vehicle_type', { length: 32 }).notNull().default('box_truck'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicle_company_idx').on(t.companyId),
    unique('vehicle_company_plate_uq').on(t.companyId, t.plate),
  ],
);

export const customer = pgTable(
  'customer',
  {
    customerId: uuid('customer_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    name: varchar('name', { length: 200 }).notNull(),
    // VN domestic phone (e.g. 0901234567), stored as a nullable string per
    // 2026 PII/E.164 guidance adapted to in-country use: digits-with-leading-0,
    // no +84. Mirrors driver.phone (varchar 32, nullable). EXPAND-only: nullable
    // so existing rows and old code that never sets phone stay valid.
    phone: varchar('phone', { length: 32 }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_company_idx').on(t.companyId),
    unique('customer_company_name_uq').on(t.companyId, t.name),
  ],
);

export const cargoType = pgTable(
  'cargo_type',
  {
    cargoTypeId: uuid('cargo_type_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    name: varchar('name', { length: 100 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('cargo_type_company_idx').on(t.companyId),
    unique('cargo_type_company_name_uq').on(t.companyId, t.name),
  ],
);

export const warehouse = pgTable(
  'warehouse',
  {
    warehouseId: uuid('warehouse_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    name: varchar('name', { length: 200 }).notNull(),
    role: varchar('role', { length: 32 }).notNull().default('pickup'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('warehouse_company_idx').on(t.companyId),
    unique('warehouse_company_name_role_uq').on(t.companyId, t.name, t.role),
  ],
);

export type Driver = typeof driver.$inferSelect;
export type NewDriver = typeof driver.$inferInsert;
export type Vehicle = typeof vehicle.$inferSelect;
export type NewVehicle = typeof vehicle.$inferInsert;
export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;
export type CargoType = typeof cargoType.$inferSelect;
export type NewCargoType = typeof cargoType.$inferInsert;
export type Warehouse = typeof warehouse.$inferSelect;
export type NewWarehouse = typeof warehouse.$inferInsert;

export const orderSequence = pgTable(
  'order_sequence',
  {
    orderSequenceId: uuid('order_sequence_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    prefix: varchar('prefix', { length: 16 }).notNull(),
    nextValue: integer('next_value').notNull().default(1),
    padWidth: integer('pad_width').notNull().default(3),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('order_sequence_company_prefix_uq').on(t.companyId, t.prefix),
  ],
);
export type OrderSequence = typeof orderSequence.$inferSelect;
export type NewOrderSequence = typeof orderSequence.$inferInsert;
