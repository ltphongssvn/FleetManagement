// apps/api/src/database/schema/reference.ts
// Reference master tables for dispatch form dropdowns: drivers, vehicles,
// customers, cargo types, warehouses. Seeded from VẬN CHUYỂN Xe Thùng PDFs.
import { pgTable, uuid, varchar, timestamp, index, integer, boolean, unique, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenancyColumns } from './tenancy.js';

// The canonical form of a person name, as SQL. Declared ONCE and reused by the
// unique index and the CHECK constraint so the two can never disagree -- a
// mismatch between them would either reject rows the index tolerates or admit
// twins the CHECK was meant to stop. Mirrors normalizeDisplayName's whitespace
// half in @fleet/domain: NFC-compose, collapse internal whitespace runs to one
// space, trim the ends. Case and accents are deliberately NOT folded here;
// accents are meaning in Vietnamese and case folding belongs in the index.
// normalize/regexp_replace/btrim are all IMMUTABLE, so this is indexable.
const canonicalName = (col: string): string =>
  "btrim(regexp_replace(normalize(" + col + ", NFC), '\\s+', ' ', 'g'))";

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
    // duplicates through; lower() folds case without stripping accents
    // (unlike unaccent/citext) and keeps the column plain text so board/export
    // ILIKE search still works (a nondeterministic collation would break ILIKE
    // pre-PG18). PARTIAL on active rows only -- mirrors dva_one_active_*_uq
    // and the soft-delete convention: a soft-deleted row (active=false) never
    // blocks re-registration.
    //
    // 2026-08-10: the fold now runs over the CANONICAL form, not the raw column.
    // lower(full_name) alone treats "NGUYEN AN BINH DUC " and "NGUYEN AN BINH
    // DUC" as different keys, and production held exactly that pair -- two ACTIVE
    // rows for one human, differing by a single trailing space. Because
    // reference-seed.ts re-inserts the canonical spelling on every boot, the
    // dispatcher's delete was undone by the next deploy, forever. Folding over
    // normalize+btrim+collapse closes the whitespace AND the Unicode-composition
    // gap in one expression.
    uniqueIndex('driver_company_active_name_ci_uq')
      .on(t.companyId, sql.raw('lower(' + canonicalName('full_name') + ')'))
      .where(sql`active = true`),
    // PARTIAL, mirroring the name index. It was a plain unique, so a
    // soft-deleted row reserved its phone permanently and re-registering that
    // person failed at the database -- production had four numbers locked this
    // way. Scoped to non-null so multiple phone-less rows remain legal.
    uniqueIndex('driver_company_active_phone_uq')
      .on(t.companyId, t.phone)
      .where(sql`active = true AND phone IS NOT NULL`),
    // The write-side half of the invariant. The index makes twins impossible;
    // this makes the NON-CANONICAL WRITE itself impossible, so no caller --
    // seed, console, or a future service that forgets DriverNameSchema -- can
    // store a name that would fork an identity. Deliberately a CHECK and not a
    // trigger: a trigger silently rewrites and hides the offending writer,
    // while a CHECK names it at the moment of the write.
    check('driver_full_name_canonical', sql.raw('full_name = ' + canonicalName('full_name'))),
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
