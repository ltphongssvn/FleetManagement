// apps/api/src/database/schema/reference.ts
// Reference master tables for dispatch form dropdowns: drivers, vehicles,
// customers, cargo types, warehouses. Seeded from VẬN CHUYỂN Xe Thùng PDFs.
import { pgTable, uuid, varchar, timestamp, index, integer, boolean, unique } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';

export const driver = pgTable(
  'driver',
  {
    driverId: uuid('driver_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    fullName: varchar('full_name', { length: 200 }).notNull(),
    operatorId: uuid('operator_id'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('driver_company_idx').on(t.companyId),
    unique('driver_company_name_uq').on(t.companyId, t.fullName),
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
