// apps/api/src/database/schema/driver-vehicle-assignment.ts
// 1:1 driver↔vehicle binding. Only one ACTIVE row per (companyId, driverId)
// and one ACTIVE row per (companyId, vehicleId). Soft-revoke via revokedAt.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, varchar, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenancyColumns } from './tenancy.js';
import { driver, vehicle } from './reference.js';

export const driverVehicleAssignment = pgTable(
  'driver_vehicle_assignment',
  {
    assignmentId: uuid('assignment_id').primaryKey().defaultRandom(),
    ...tenancyColumns,
    driverId: uuid('driver_id').notNull().references(() => driver.driverId),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicle.vehicleId),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revocationReason: varchar('revocation_reason', { length: 64 }),
  },
  (t) => [
    index('dva_driver_idx').on(t.driverId),
    index('dva_vehicle_idx').on(t.vehicleId),
    uniqueIndex('dva_one_active_per_driver_uq')
      .on(t.companyId, t.driverId)
      .where(sql`revoked_at IS NULL`),
    uniqueIndex('dva_one_active_per_vehicle_uq')
      .on(t.companyId, t.vehicleId)
      .where(sql`revoked_at IS NULL`),
  ],
);

export type DriverVehicleAssignment = typeof driverVehicleAssignment.$inferSelect;
export type NewDriverVehicleAssignment = typeof driverVehicleAssignment.$inferInsert;
